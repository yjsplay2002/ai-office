// 대표 텔레그램: 새 TODO·최종 보고 알림을 보내고, 답장·지시·첨부 파일을 받는다.
// Only messages from the one allowed chat are ever acted on: a message here can start a claude run.
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// This project talks to the CEO through its own bot only (.office-telegram.env or OFFICE_TG_TOKEN), never the
// Claude Code Telegram plugin's bot. The plugin's access.json is read only for the CEO's chat id.
export function telegramConfig(root, env = process.env) {
  const kv = (file) => { try { return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]])); } catch { return {}; } };
  const own = kv(path.join(root, '.office-telegram.env'));
  let pluginChat;
  try { pluginChat = JSON.parse(readFileSync(path.join(os.homedir(), '.claude', 'channels', 'telegram', 'access.json'), 'utf8')).allowFrom?.[0]; } catch {}
  const chat = String(env.OFFICE_TG_CHAT || own.TELEGRAM_CHAT_ID || pluginChat || '');
  const token = env.OFFICE_TG_TOKEN || own.TELEGRAM_BOT_TOKEN;
  return token && chat ? { token, chat, inbound: true } : null;
}

// Send files to the CEO: images as albums (10 per message), anything else as documents. Caption goes on the first.
export async function sendFiles(cfg, files, caption = '') {
  const IMG = /\.(png|jpe?g|webp|gif)$/i;
  const post = async (method, form) => {
    const r = await fetch(`https://api.telegram.org/bot${cfg.token}/${method}`, { method: 'POST', body: form });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(`${method}: ${j.description || r.status}`);
  };
  const blob = (f) => new Blob([readFileSync(f)]);
  const photos = files.filter((f) => IMG.test(f) && statSync(f).size < 10e6), docs = files.filter((f) => !photos.includes(f));
  let cap = String(caption).slice(0, 1000);
  for (let i = 0; i < photos.length; i += 10) {
    const group = photos.slice(i, i + 10), form = new FormData();
    form.append('chat_id', cfg.chat);
    if (group.length === 1) { form.append('photo', blob(group[0]), path.basename(group[0])); if (cap) form.append('caption', cap); await post('sendPhoto', form); }
    else {
      form.append('media', JSON.stringify(group.map((_, k) => ({ type: 'photo', media: `attach://f${k}`, ...(k === 0 && cap ? { caption: cap } : {}) }))));
      group.forEach((f, k) => form.append(`f${k}`, blob(f), path.basename(f)));
      await post('sendMediaGroup', form);
    }
    cap = '';
  }
  for (const f of docs) {
    const form = new FormData();
    form.append('chat_id', cfg.chat); form.append('document', blob(f), path.basename(f));
    if (cap) form.append('caption', cap);
    await post('sendDocument', form);
    cap = '';
  }
  if (cap) { const form = new FormData(); form.append('chat_id', cfg.chat); form.append('text', cap); await post('sendMessage', form); }
}

// Pure: what an incoming text means. todos = open TODOs, replyTodo = id of the TODO message it replies to (if any).
// files = number of attached files (a file alone can answer an 입력 TODO).
export function parseCommand(text, { replyTodo = null, todos = [], files = 0 } = {}) {
  const s = String(text || '').trim();
  const cmd = s.match(/^\/([^\s@]+)/);
  if (cmd) return { kind: ({ start: 'help', help: 'help', todo: 'todos', todos: 'todos', status: 'status', cancel: 'cancel' })[cmd[1].toLowerCase()] || 'help' };
  let id = replyTodo, rest = s;
  const tag = s.match(/^T(\d+)\b[\s:：.\-—]*([\s\S]*)$/i);
  if (tag && todos.some((t) => t.id === Number(tag[1]))) { id = Number(tag[1]); rest = tag[2]; }
  if (id == null) return s ? { kind: 'run', prompt: s } : { kind: 'none' };
  const todo = todos.find((t) => t.id === id);
  if (!todo) return { kind: 'error', text: `T${id}은 이미 처리됐거나 없어요.` };
  if (todo.options.length) {
    const [first, ...more] = rest.split(/\s+/);
    const byNum = /^\d+$/.test(first || '') ? todo.options[Number(first) - 1] : null;
    const exact = todo.options.find((o) => rest === o || (rest.startsWith(o) && SEP.test(rest.slice(o.length))));
    const answer = byNum || exact;
    if (!answer && todo.type === '확인' && rest) return { kind: 'answer', id, answer: '추가 지시', note: rest };   // 보고에 글로 답하면 추가 지시
    if (!answer) return { kind: 'error', text: `T${id} 보기 중에서 골라 주세요: ${todo.options.map((o, i) => `${i + 1}. ${o}`).join('  ')}` };
    return { kind: 'answer', id, answer, note: (byNum ? more.join(' ') : rest.slice(answer.length).replace(SEP_ALL, '')).trim() };
  }
  if (todo.type === '입력') return rest || files ? { kind: 'answer', id, answer: rest || '첨부 참고', note: '' } : { kind: 'error', text: `T${id} 답을 적어 주세요.` };
  return { kind: 'answer', id, answer: '', note: rest };   // 실행/승인 without options: done, with an optional memo
}

const SEP = /^[\s:：,.\-—]/, SEP_ALL = /^[\s:：,.\-—]+/;

// Pure: where an incoming text/file message goes. choice = a button just pressed ({ id, answer }) waiting for a reason:
// the next message goes to it unless it replies to (or names) another TODO. Text with no target = new instruction.
export function routeMessage(text, { replyTodo = null, todos = [], choice = null, files = 0 } = {}) {
  const s = String(text || '').trim();
  if (!s && !files) return { kind: 'none' };   // e.g. a sticker
  const tag = s.match(/^T(\d+)\b/i);
  const other = (replyTodo != null && replyTodo !== choice?.id) || (tag && Number(tag[1]) !== choice?.id && todos.some((t) => t.id === Number(tag[1])));
  if (choice && !other) return { kind: 'answer', id: choice.id, answer: choice.answer, note: tag && Number(tag[1]) === choice.id ? s.replace(/^T\d+[\s:：.\-—]*/i, '') : s };
  if (!s && files) return replyTodo == null ? { kind: 'wait' } : parseCommand('', { replyTodo, todos, files });
  return parseCommand(s, { replyTodo, todos, files });
}

const HELP = [
  '이 채팅으로 AI 오피스에 일을 시킬 수 있어요.',
  '• 그냥 메시지 → 새 지시 (대시보드 지시하기와 같음)',
  '• TODO 버튼(보기·승인/반려·완료)을 누른 뒤 보내는 글·파일은 그 TODO의 이유·메모로 함께 기록돼요. 없으면 [이대로 확정].',
  '• TODO 알림에 답장, 또는 "T12 답" → 그 TODO에 글로 답하기 (예: "반려 색이 너무 어두움"). 사진·파일 답장도 돼요.',
  '• 그 밖에 보낸 파일·사진은 지시에 첨부돼요. 설명은 캡션에 쓰거나 바로 다음 메시지로 보내세요.',
  '• /todo 열린 TODO · /status 진행 상황 · /cancel 모든 작업 취소',
].join('\n');

export function createTelegram({ cfg, url, runDir, todos, status, onRun, onAnswer, onCancel, log = console.log }) {
  const api = async (method, body) => {
    const r = await fetch(`https://api.telegram.org/bot${cfg.token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw Object.assign(new Error(j.description || `HTTP ${r.status}`), { code: j.error_code || r.status });
    return j.result;
  };
  const send = (text, extra = {}) => api('sendMessage', { chat_id: cfg.chat, text: String(text).slice(0, 4000), disable_web_page_preview: true, ...extra })
    .catch((err) => { log('텔레그램 보내기 실패:', err.message); return null; });

  // message_id of each TODO notification -> TODO id, so a reply answers that TODO (kept across restarts).
  const mapFile = path.join(runDir, 'telegram.map');
  const msgTodo = new Map(existsSync(mapFile) ? (() => { try { return JSON.parse(readFileSync(mapFile, 'utf8')); } catch { return []; } })() : []);
  const remember = (mid, id) => { msgTodo.set(mid, id); writeFileSync(mapFile, JSON.stringify([...msgTodo].slice(-300))); };
  const keys = (t) => (t.options.length ? t.options.map((o, i) => [{ text: o, callback_data: `a:${t.id}:${i}` }]) : t.type === '실행' ? [[{ text: '완료', callback_data: `a:${t.id}:x` }]] : []);
  const buttons = (t) => (keys(t).length ? { reply_markup: { inline_keyboard: keys(t) } } : {});
  const howTo = (t) => (t.type === '확인' ? '끝내려면 [종료]를, 이어서 시킬 일이 있으면 이 메시지에 답장으로 적어 주세요([추가 지시]를 누른 뒤 보내도 돼요).'
    : !keys(t).length ? '이 메시지에 답장으로 글이나 파일(사진·문서·음성)을 보내 주세요.'
    : `${t.type === '실행' ? '했으면 [완료]를' : t.type === '승인' ? '승인/반려를' : '보기 버튼을'} 누르세요. 이유·메모·파일은 누른 뒤 바로 보내면 함께 기록돼요. 이 메시지에 답장해도 돼요.`);
  const todoText = (t) => `📋 대표 TODO T${t.id} · ${t.type} · ${t.by}\n${t.desc}${t.ref ? `\n근거: ${t.ref}` : ''}\n\n${howTo(t)}`;

  async function notifyTodo(t) { const m = await send(`${todoText(t)}\n${url}`, buttons(t)); if (m) remember(m.message_id, t.id); }
  const notify = (text) => send(`${text}\n\n${url}`);
  const progress = (text) => send(text, { disable_notification: true });   // 중간 보고는 무음

  async function download(list) {
    const out = [];
    for (const f of list) {
      const info = await api('getFile', { file_id: f.id });
      const r = await fetch(`https://api.telegram.org/file/bot${cfg.token}/${info.file_path}`);
      if (!r.ok) throw new Error(`파일 받기 실패 (${f.name})`);
      out.push({ name: f.name || path.basename(info.file_path), data: Buffer.from(await r.arrayBuffer()).toString('base64') });
    }
    return out;
  }
  function filesOf(m) {
    const out = [];
    if (m.document) out.push({ id: m.document.file_id, name: m.document.file_name });
    if (m.photo?.length) out.push({ id: m.photo.at(-1).file_id, name: `photo-${m.message_id}.jpg` });
    for (const k of ['video', 'audio', 'voice', 'animation']) if (m[k]) out.push({ id: m[k].file_id, name: m[k].file_name || `${k}-${m.message_id}.${{ voice: 'ogg', audio: 'mp3' }[k] || 'mp4'}` });
    return out;
  }

  // Files and their caption (or the next message) are gathered for a moment, so an album arrives as one instruction.
  let pending = { files: [], text: '', replyTodo: null, timer: null, since: 0 };
  // A pressed TODO button waits CHOICE_MIN for a reason (text/file) before it is written.
  // shortcut: in memory only — a restart drops it, but nothing was written so the TODO stays open and the button still works.
  const CHOICE_MIN = 5;
  let choice = null;   // { id, answer, mid, text, timer }
  async function commit(c, files = []) {
    const ch = choice?.id === c.id ? choice : null;
    if (ch) { clearTimeout(ch.timer); choice = null; }
    try {
      const full = await onAnswer(c.id, c.answer, c.note, files);
      if (ch) await api('editMessageText', { chat_id: cfg.chat, message_id: ch.mid, text: `${ch.text}\n\n→ 답: ${full}` }).catch(() => {});
      await send(`✅ T${c.id} 처리: ${full}\nPM이 이어서 진행해요.`);
    } catch (err) { await send(`⚠️ ${err.message}`); }
  }
  async function act(c, files) {
    try {
      if (c.kind === 'run') { await onRun(c.prompt, files); await send(`🫡 지시 받았어요${files.length ? ` (첨부 ${files.length}개)` : ''}. 끝나면 보고드릴게요.`); }
      else if (c.kind === 'answer') await commit(c, files);
      else if (c.kind === 'error') await send(`⚠️ ${c.text}`);
    } catch (err) { await send(`⚠️ ${err.message}`); }
  }
  async function flush() {
    const p = pending; pending = { files: [], text: '', replyTodo: null, timer: null, since: 0 };
    const c = routeMessage(p.text, { replyTodo: p.replyTodo, todos: todos(), choice, files: p.files.length });
    if (c.kind === 'wait') {   // files only, no target: keep them for the next message
      pending = { ...p, timer: null };
      return send(`📎 파일 ${p.files.length}개 받았어요. 지시 내용을 이어서 보내거나, TODO 답이면 그 TODO 알림에 답장으로 보내 주세요.`);
    }
    let files = [];
    if (c.kind === 'run' || c.kind === 'answer') {
      try { files = await download(p.files); } catch (err) { return send(`⚠️ ${err.message}`); }
    }
    await act(c, files);
  }
  async function onMessage(m) {
    const text = m.text || m.caption || '';
    if (/^\//.test(text.trim())) {
      const c = parseCommand(text);
      if (c.kind === 'help') return send(HELP);
      if (c.kind === 'status') return send(status());
      if (c.kind === 'cancel') return send('진행 중인 작업을 모두 취소할까요?', { reply_markup: { inline_keyboard: [[{ text: '모두 취소', callback_data: 'cancel' }, { text: '그대로 두기', callback_data: 'keep' }]] } });
      const open = todos();
      if (!open.length) return send('열린 TODO가 없어요.');
      for (const t of open) await notifyTodo(t);
      return;
    }
    if (pending.since && Date.now() - pending.since > 30 * 60e3) pending = { files: [], text: '', replyTodo: null, timer: null, since: 0 };   // 30분 지난 첨부는 버림
    pending.since ||= Date.now();
    const files = filesOf(m);
    pending.files.push(...files);
    if (text.trim()) pending.text = pending.text ? `${pending.text}\n${text}` : text;
    const rid = m.reply_to_message && msgTodo.get(m.reply_to_message.message_id);
    if (rid != null) pending.replyTodo = rid;
    clearTimeout(pending.timer);
    if (!files.length) return flush();   // plain text goes at once (taking any files sent just before it)
    pending.timer = setTimeout(() => flush().catch((err) => log('텔레그램 처리 실패:', err.message)), 1500);
  }
  async function onCallback(q) {
    await api('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
    if (q.data === 'keep') return api('editMessageText', { chat_id: cfg.chat, message_id: q.message.message_id, text: '취소하지 않았어요.' }).catch(() => {});
    if (q.data === 'cancel') { const n = onCancel(); return api('editMessageText', { chat_id: cfg.chat, message_id: q.message.message_id, text: `🛑 작업 ${n}건 모두 취소했어요.` }).catch(() => {}); }
    const ok = q.data?.match(/^ok:(\d+)$/);
    if (ok) return choice?.id === Number(ok[1]) ? commit({ id: choice.id, answer: choice.answer, note: '' }) : send(`⚠️ T${ok[1]}은 이미 처리됐어요.`);
    const a = q.data?.match(/^a:(\d+):(\d+|x)$/);
    if (!a) return;
    const id = Number(a[1]), todo = todos().find((t) => t.id === id);
    const answer = a[2] === 'x' ? '' : todo?.options[Number(a[2])];
    if (!todo || answer == null) return send(`⚠️ T${id}은 이미 처리됐어요.`);
    if (choice && choice.id !== id) await commit({ id: choice.id, answer: choice.answer, note: '' });   // another TODO's button: settle the first
    clearTimeout(choice?.timer);
    const ch = { id, answer, mid: q.message.message_id, text: choice?.id === id ? choice.text : q.message.text };
    ch.timer = setTimeout(() => { if (choice === ch) commit({ id, answer, note: '' }).catch(() => {}); }, CHOICE_MIN * 60e3);
    choice = ch;
    const label = answer || '완료';
    await api('editMessageText', { chat_id: cfg.chat, message_id: ch.mid, text: `${ch.text}\n\n→ 선택: ${label} (${CHOICE_MIN}분 뒤 자동 확정)`,
      reply_markup: { inline_keyboard: [...keys(todo), [{ text: '✔ 이대로 확정', callback_data: `ok:${id}` }]] } }).catch(() => {});
    // force_reply opens a reply to this prompt, so the reason maps to this TODO even after the window.
    const m = await send(`T${id} '${label}' 선택. 이유·메모·파일이 있으면 지금 보내 주세요(답장). 없으면 [이대로 확정]을 누르거나 ${CHOICE_MIN}분 기다리면 그대로 기록돼요.`,
      { reply_markup: { force_reply: true, input_field_placeholder: '이유 (선택)' } });
    if (m) remember(m.message_id, id);
  }

  async function poll() {
    let offset = 0, warned = false;
    for (;;) {
      try {
        const ups = await api('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] });
        warned = false;
        for (const u of ups) {
          offset = u.update_id + 1;
          const from = String(u.message?.from?.id ?? u.callback_query?.from?.id ?? '');
          if (from !== cfg.chat) continue;   // trust boundary: nobody else can command the office
          if (u.message) await onMessage(u.message).catch((err) => log('텔레그램 처리 실패:', err.message));
          if (u.callback_query) await onCallback(u.callback_query).catch((err) => log('텔레그램 처리 실패:', err.message));
        }
      } catch (err) {
        if (!warned) log(`텔레그램 받기 오류: ${err.message}${err.code === 409 ? ' — 같은 봇을 다른 곳(텔레그램 플러그인 등)이 읽고 있어요. 오피스 전용 봇을 쓰세요.' : ''}`);
        warned = true;
        await new Promise((r) => setTimeout(r, err.code === 409 ? 30e3 : 5e3));
      }
    }
  }
  if (cfg.inbound) poll();
  return { notify, notifyTodo, progress };
}
