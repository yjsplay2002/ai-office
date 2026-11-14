// 대표 슬랙: 오피스 전용 채널 하나에 대시보드 스레드를 그대로 옮긴다(스레드 하나 = 슬랙 스레드 하나).
// 지시는 스레드 첫 메시지, 팀원 진행·최종 보고·TODO 카드는 그 스레드 답글. 채널에 새 글 = 새 지시, 스레드 답글 = 댓글,
// TODO 카드 버튼 = 답. 받는 쪽은 Socket Mode(공개 주소 없이 웹소켓)라 127.0.0.1 서버에서도 돈다.
// Only the one owner (SLACK_USER_ID) in the office channel is ever acted on: a message here can start a claude run.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseCommand } from './telegram.mjs';

export function slackConfig(root, env = process.env) {
  let own = {};
  try { own = Object.fromEntries(readFileSync(path.join(root, '.office-slack.env'), 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]])); } catch {}
  // 환경 변수는 OFFICE_ 붙은 것만: 셸의 SLACK_BOT_TOKEN 등은 다른 슬랙 앱 것일 수 있다(그 앱의 Socket Mode 이벤트를 뺏어 옴)
  const get = (k) => env['OFFICE_' + k] || own[k] || '';
  const token = get('SLACK_BOT_TOKEN'), owner = get('SLACK_USER_ID');
  if (!token || !owner) return null;
  return { token, owner, app: get('SLACK_APP_TOKEN'), channel: get('SLACK_CHANNEL_ID'), name: channelName(get('SLACK_CHANNEL') || path.basename(root)), url: get('OFFICE_URL') };
}

// 슬랙 채널 이름: 영문 소문자·숫자·-·_만, 80자까지. 폴더 이름에서 만든다(한글만 있으면 ai-office).
export function channelName(s) {
  const n = String(s).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '');
  return (n.startsWith('ai-office') ? n : n ? `ai-office-${n}` : 'ai-office').slice(0, 80);
}

const unescape = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// Pure: 슬랙 메시지 이벤트 하나가 무엇이 되는지. threadOf(ts) = 그 슬랙 스레드의 대시보드 스레드 번호(없으면 null).
export function routeSlack(ev, { owner, channel, threadOf, todos = [] }) {
  if (!ev || ev.type !== 'message' || ev.subtype || ev.bot_id) return { kind: 'none' };   // 편집·입장 알림·봇 글(우리 글 포함)
  if (ev.user !== owner || ev.channel !== channel) return { kind: 'none' };   // trust boundary
  const text = unescape(ev.text).trim();
  if (!text) return { kind: 'none' };
  if (!ev.thread_ts || ev.thread_ts === ev.ts) return { kind: 'run', prompt: text, ts: ev.ts };
  const thread = threadOf(ev.thread_ts);
  if (thread == null) return { kind: 'error', ts: ev.thread_ts, text: '이 스레드는 대시보드 스레드와 이어져 있지 않아요. 채널에 새 글로 지시해 주세요.' };
  if (/^T\d+\b/i.test(text)) {   // "T12 반려 색이 어두움" = 그 TODO에 답
    const c = parseCommand(text, { todos });
    if (c.kind === 'answer' || c.kind === 'error') return { ...c, ts: ev.thread_ts };
  }
  return { kind: 'comment', thread, text, ts: ev.thread_ts };
}

// TODO 카드: 보기마다 버튼. 누르면 메모 칸이 있는 창이 뜨고 보내면 답이 된다.
export function todoCard(t, owner) {
  const head = `<@${owner}> 📋 *T${t.id} · ${t.type} · ${t.by}*\n${t.desc}${t.ref ? `\n근거: \`${t.ref}\`` : ''}`;
  const opts = t.options.length ? t.options : [t.type === '입력' ? '답하기' : '완료'];
  return { text: `T${t.id} ${t.type}: ${t.desc.split('\n')[0]}`.slice(0, 300),
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: head.slice(0, 2900) } },
      { type: 'actions', elements: opts.slice(0, 25).map((o, i) => ({ type: 'button', action_id: `todo_${i}`, text: { type: 'plain_text', text: o.slice(0, 70) },
        value: JSON.stringify({ id: t.id, answer: t.options.length ? o : '' }), ...(o === '승인' ? { style: 'primary' } : o === '반려' ? { style: 'danger' } : {}) })) }] };
}

// 메모 창: 입력 TODO와 '추가 지시'는 글이 꼭 있어야 한다.
export function answerModal(t, answer, meta) {
  const must = t.type === '입력' || answer === '추가 지시';
  return { type: 'modal', callback_id: 'todo_answer', private_metadata: JSON.stringify(meta).slice(0, 3000),
    title: { type: 'plain_text', text: `T${t.id} 답` }, submit: { type: 'plain_text', text: '보내기' }, close: { type: 'plain_text', text: '닫기' },
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*${answer || (t.type === '입력' ? '답' : '완료')}*\n${t.desc.slice(0, 2500)}` } },
      { type: 'input', block_id: 'note', optional: !must, label: { type: 'plain_text', text: must ? (answer === '추가 지시' ? '이어서 시킬 일' : '답') : '이유·메모 (선택)' },
        element: { type: 'plain_text_input', action_id: 'v', multiline: true } }] };
}

const firstLine = (s, n = 200) => { const l = (String(s || '').split('\n').map((x) => x.trim()).find(Boolean) || '').replace(/^#+\s*/, ''); return l.length > n ? l.slice(0, n - 1) + '…' : l; };

export function createSlack({ cfg, runDir, todos, threadPrompt, onRun, onComment, onAnswer, log = console.log }) {
  const stateFile = path.join(runDir, 'slack.json');
  let st = { channel: cfg.channel || null, threads: {}, todos: {} };
  try { st = { ...st, ...JSON.parse(readFileSync(stateFile, 'utf8')), ...(cfg.channel ? { channel: cfg.channel } : {}) }; } catch {}
  const save = () => { try { writeFileSync(stateFile, JSON.stringify(st)); } catch {} };
  const threadOf = (ts) => { const k = Object.keys(st.threads).find((th) => st.threads[th] === ts); return k == null ? null : Number(k); };

  async function api(method, body, token = cfg.token) {
    for (let i = 0; ; i++) {
      const r = await fetch(`https://slack.com/api/${method}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body || {}) });
      if (r.status === 429 && i < 3) { await new Promise((ok) => setTimeout(ok, (Number(r.headers.get('retry-after')) || 2) * 1000)); continue; }
      const j = await r.json().catch(() => ({}));
      if (!j.ok) throw Object.assign(new Error(`${method}: ${j.error || r.status}`), { code: j.error });
      return j;
    }
  }
  // 보내기는 한 줄로 세운다: 같은 스레드 머리글이 두 번 생기지 않고 순서도 지켜진다.
  let chain = ready().catch((err) => log('슬랙 채널 준비 실패(보내기가 안 돼요):', err.message));
  const queue = (fn) => (chain = chain.then(fn).catch((err) => log('슬랙 보내기 실패:', err.message)));

  async function ready() {
    if (!st.channel) {
      try { st.channel = (await api('conversations.create', { name: cfg.name, is_private: true })).channel.id; log(`슬랙: #${cfg.name} 채널을 만들었어요`); }
      catch (err) {
        if (err.code !== 'name_taken') throw err;
        for (let cursor; ;) {   // 이미 있으면 봇이 들어가 있는 같은 이름 채널을 쓴다
          const j = await api('conversations.list', { types: 'private_channel,public_channel', limit: 200, exclude_archived: true, cursor });
          const c = j.channels.find((x) => x.name === cfg.name && x.is_member);
          if (c) { st.channel = c.id; break; }
          if (!(cursor = j.response_metadata?.next_cursor)) throw new Error(`#${cfg.name} 채널이 이미 있는데 봇이 들어가 있지 않아요. 봇을 그 채널에 초대하거나 .office-slack.env의 SLACK_CHANNEL로 다른 이름을 주세요`);
        }
      }
      save();
    }
    await api('conversations.invite', { channel: st.channel, users: cfg.owner }).catch((err) => { if (!['already_in_channel', 'cant_invite_self'].includes(err.code)) log('슬랙 대표 초대 실패:', err.message); });
  }

  const post = (body) => api('chat.postMessage', { channel: st.channel, unfurl_links: false, ...body });
  // 대시보드 스레드의 슬랙 머리글. 없으면(슬랙을 켜기 전 스레드, 다시 붙은 실행) 그 스레드의 지시로 만든다.
  async function root(thread, prompt = threadPrompt(thread), extra = '') {
    if (st.threads[thread]) return st.threads[thread];
    const m = await post({ text: `🧵 ${firstLine(prompt, 150)}`, blocks: [{ type: 'markdown', text: `**🧵 ${firstLine(prompt, 150)}**${extra}\n\n${String(prompt || '').slice(0, 2500)}` }] });
    st.threads[thread] = m.ts; save();
    return m.ts;
  }
  const reply = (thread, body) => queue(async () => post({ thread_ts: await root(thread), ...body }));
  const md = (thread, text, fallback) => reply(thread, { text: fallback || firstLine(text, 150), blocks: [{ type: 'markdown', text: String(text).slice(0, 11000) }] });

  let origin = null;   // 지금 처리 중인 슬랙 메시지: 그 지시·댓글은 슬랙에 다시 쓰지 않는다
  // 실행 시작. thread = 이 실행이 속한 대시보드 스레드, shown = 슬랙에 보일 짧은 글(대시보드 댓글이면 그 댓글)
  function runStarted({ id, thread, prompt, title, from, shown }) {
    const o = origin;
    if (thread === id) {
      if (o) { st.threads[thread] = o; save(); return; }
      return queue(() => root(thread, title ? `${title}\n${prompt}` : prompt, from != null ? `\n_↪ 스레드에서 새 주제로 갈라져 나온 일_` : ''));
    }
    if (o) return;
    md(thread, `▶ ${shown ? `대표 댓글: ${shown}` : String(prompt).split('\n\n')[0]}`.slice(0, 2000));   // TODO 답이면 답 줄들
  }
  const progress = (thread, text) => reply(thread, { text });
  function report(thread, obj, list) {
    const body = String(obj.result || '').trim() || '(내용 없음)';
    md(thread, `<@${cfg.owner}> ${obj.is_error ? '⚠️ **최종 보고 (오류)**' : '✅ **최종 보고**'}\n\n${body}`, `${obj.is_error ? '최종 보고(오류)' : '최종 보고'}: ${firstLine(body, 120)}`);
    for (const t of list) notifyTodo(t, thread);
  }
  function notifyTodo(t, thread) {
    if (st.todos[t.id] || thread == null) return;
    st.todos[t.id] = { thread };
    queue(async () => { const m = await post({ thread_ts: await root(thread), ...todoCard(t, cfg.owner) }); st.todos[t.id] = { thread, ts: m.ts }; save(); });
  }
  // 답했거나 지운 TODO 카드는 버튼을 내리고 답을 적는다(대시보드·텔레그램에서 답해도).
  function todoDone(t) {
    const c = st.todos[t.id];
    if (!c?.ts) return;
    delete st.todos[t.id]; save();
    queue(() => api('chat.update', { channel: st.channel, ts: c.ts, text: `T${t.id} 처리됨`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `~T${t.id} · ${t.type} · ${t.by}~ ${firstLine(t.desc, 150)}\n→ *${t.answer || '완료'}*`.slice(0, 2900) } }] }));
  }
  const closed = (thread) => st.threads[thread] && reply(thread, { text: '🛑 대표가 이 스레드를 종료했어요.' });
  const reopened = (thread) => st.threads[thread] && reply(thread, { text: '↩ 스레드를 다시 열었어요. 답글을 달면 PM이 이어 가요.' });
  const openTodos = () => Object.keys(st.todos).map(Number);

  // ---------- 받기: Socket Mode ----------
  const seen = new Set();
  async function onEvent(ev) {
    const c = routeSlack(ev, { owner: cfg.owner, channel: st.channel, threadOf, todos: todos() });
    if (c.kind === 'none') return;
    const say = (text) => queue(() => post({ thread_ts: c.ts, text }));
    try {
      if (c.kind === 'error') return say(`⚠️ ${c.text}`);
      if (c.kind === 'answer') { const full = await onAnswer(c.id, c.answer, c.note); return say(`✅ T${c.id} 처리: ${full}`); }
      origin = c.ts;
      try { c.kind === 'run' ? onRun(c.prompt) : onComment(c.thread, c.text); } finally { origin = null; }
      say(c.kind === 'run' ? '🫡 지시 받았어요. 이 스레드에 진행과 보고를 올릴게요. 답글은 댓글로 PM에게 가요.' : '🫡 받았어요.');
    } catch (err) { say(`⚠️ ${err.message}`); }
  }
  async function onInteractive(p, ack) {
    if (p.user?.id !== cfg.owner) return ack();
    if (p.type === 'block_actions') {
      ack();
      const a = p.actions?.[0]; if (!a?.action_id?.startsWith('todo_')) return;
      const { id, answer } = JSON.parse(a.value), t = todos().find((x) => x.id === id);
      if (!t) return queue(() => post({ thread_ts: p.message?.thread_ts || p.message?.ts, text: `⚠️ T${id}은 이미 처리됐어요.` }));
      return api('views.open', { trigger_id: p.trigger_id, view: answerModal(t, answer, { id, answer, thread: p.message?.thread_ts }) }).catch((err) => log('슬랙 창 열기 실패:', err.message));
    }
    if (p.type === 'view_submission' && p.view?.callback_id === 'todo_answer') {
      const m = JSON.parse(p.view.private_metadata || '{}'), note = p.view.state?.values?.note?.v?.value || '';
      try {
        const full = await onAnswer(m.id, m.answer, note);
        ack();
        if (m.thread) queue(() => post({ thread_ts: m.thread, text: `✅ T${m.id} 처리: ${full}` }));
      } catch (err) { ack({ response_action: 'errors', errors: { note: err.message.slice(0, 150) } }); }
      return;
    }
    ack();
  }
  async function connect() {
    try {
      await chain;
      const { url } = await api('apps.connections.open', {}, cfg.app);
      const ws = new WebSocket(url);
      ws.onmessage = (m) => {
        let e; try { e = JSON.parse(m.data); } catch { return; }
        if (e.type === 'disconnect') return ws.close();
        if (!e.envelope_id) return;
        const ack = (payload) => ws.send(JSON.stringify(payload ? { envelope_id: e.envelope_id, payload } : { envelope_id: e.envelope_id }));
        if (e.type === 'interactive') return onInteractive(e.payload, ack).catch((err) => log('슬랙 처리 실패:', err.message));
        ack();
        const id = e.payload?.event_id;
        if (e.type !== 'events_api' || seen.has(id)) return;   // 다시 보낸 이벤트는 한 번만
        seen.add(id); if (seen.size > 500) seen.delete(seen.values().next().value);
        onEvent(e.payload.event).catch((err) => log('슬랙 처리 실패:', err.message));
      };
      ws.onclose = () => setTimeout(connect, 2000);
    } catch (err) { log('슬랙 받기 연결 실패:', err.message); setTimeout(connect, 30e3); }
  }
  if (cfg.app && typeof WebSocket === 'function') connect();
  else log(cfg.app ? '슬랙: 이 Node에는 WebSocket이 없어 보내기만 해요(Node 22 이상이면 받기도 됨)' : '슬랙: SLACK_APP_TOKEN이 없어 보내기만 해요');
  chain.then(() => st.channel && log(`슬랙: #${cfg.name} 채널로 스레드·알림 연동${cfg.app ? ' + 지시·댓글·TODO 답 받기' : ''}`));
  return { runStarted, progress, report, notifyTodo, todoDone, closed, reopened, openTodos };
}
