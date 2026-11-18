// 대표 슬랙: 오피스 전용 채널 하나에 대시보드 스레드를 그대로 옮긴다(스레드 하나 = 슬랙 스레드 하나).
// 지시는 스레드 첫 메시지, 팀원 진행·최종 보고·TODO 카드는 그 스레드 답글. 채널에 새 글 = 새 지시, 스레드 답글 = 댓글,
// TODO 카드 버튼 = 답. 받는 쪽은 Socket Mode(공개 주소 없이 웹소켓)라 127.0.0.1 서버에서도 돈다.
// Only the one owner (SLACK_USER_ID) in the office channel is ever acted on: a message here can start a claude run.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCommand } from './telegram.mjs';
import { readAgent } from './staff.mjs';
import { mediaIn } from './map.mjs';
import { mediaFile } from './files.mjs';
import { SUPERSEDED } from './todos.mjs';

export function slackConfig(root, env = process.env) {
  let own = {};
  try { own = Object.fromEntries(readFileSync(path.join(root, '.office-slack.env'), 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]])); } catch {}
  // 환경 변수는 OFFICE_ 붙은 것만: 셸의 SLACK_BOT_TOKEN 등은 다른 슬랙 앱 것일 수 있다(그 앱의 Socket Mode 이벤트를 뺏어 옴)
  const get = (k) => env['OFFICE_' + k] || own[k] || '';
  const token = get('SLACK_BOT_TOKEN'), owner = get('SLACK_USER_ID');
  if (!token || !owner) return null;
  // 팀원 봇: SLACK_BOT_TOKEN_<팀원 이름 대문자>=xoxb-… (팀원마다 슬랙 앱 하나, botKey 참고)
  const bots = {};
  for (const k of new Set([...Object.keys(own), ...Object.keys(env).filter((x) => x.startsWith('OFFICE_')).map((x) => x.slice(7))])) {
    const m = k.match(/^SLACK_BOT_TOKEN_([A-Z0-9_]+)$/);
    if (m && get(k)) bots[m[1]] = get(k);
  }
  return { token, owner, app: get('SLACK_APP_TOKEN'), channel: get('SLACK_CHANNEL_ID'), name: channelName(get('SLACK_CHANNEL') || path.basename(root)), url: get('OFFICE_URL'), bots };
}
export const botKey = (agent) => String(agent).toUpperCase().replace(/[^A-Z0-9]/g, '_');

// 팀원 슬랙 앱 매니페스트: 보내기(chat:write)와 결과물 올리기(files:write)만. 받기는 PM 앱 하나의 Socket Mode가 채널 전체를 듣는다.
export function memberManifest({ id, role, name }) {
  const shown = (name || role || id).slice(0, 35), app = [role, name && `「${name}」`].filter(Boolean).join(' ') || id;
  return { display_information: { name: app.slice(0, 35), description: `AI 오피스 팀원 ${id}` },
    features: { bot_user: { display_name: shown, always_online: true } },
    oauth_config: { scopes: { bot: ['chat:write', 'files:write'] } },
    settings: { org_deploy_enabled: false, socket_mode_enabled: false, token_rotation_enabled: false } };
}
// .claude/agents/*.md마다 .claude/slack-apps/<id>.json을 쓰고, 아직 토큰이 없는 팀원을 돌려준다.
export function writeApps(root, bots = {}) {
  const dir = path.join(root, '.claude', 'agents'), out = path.join(root, '.claude', 'slack-apps');
  const list = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => {
    const text = readFileSync(path.join(dir, f), 'utf8'), id = (text.match(/^name:\s*(\S+)/m) || [])[1] || f.slice(0, -3);
    return readAgent(text, id);
  }) : [];
  if (list.length) mkdirSync(out, { recursive: true });
  for (const a of list) writeFileSync(path.join(out, `${a.id}.json`), JSON.stringify(memberManifest(a), null, 2) + '\n');
  return { all: list.map((a) => a.id), missing: list.filter((a) => !bots[botKey(a.id)]).map((a) => a.id) };
}

// 슬랙 채널 이름: 영문 소문자·숫자·-·_만, 80자까지. 폴더 이름에서 만든다(한글만 있으면 ai-office).
export function channelName(s) {
  const n = String(s).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '');
  return (n.startsWith('ai-office') ? n : n ? `ai-office-${n}` : 'ai-office').slice(0, 80);
}

const unescape = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// Pure: 슬랙 메시지 이벤트 하나가 무엇이 되는지. threadOf(ts) = 그 슬랙 스레드의 대시보드 스레드 번호(없으면 null).
// members = { 봇 사용자 ID: 팀원 이름 }, self = PM 봇 사용자 ID. 첫 봇 멘션이 member: 팀원 이름, PM 봇이면 ''(그 스레드를 팀원이 맡고 있어도 PM에게). 멘션은 글에서 뺀다.
export function routeSlack(ev, { owner, channel, threadOf, todos = [], members = {}, self = '' }) {
  if (!ev || ev.type !== 'message' || (ev.subtype && ev.subtype !== 'file_share') || ev.bot_id) return { kind: 'none' };   // 편집·입장 알림·봇 글(우리 글 포함). 첨부 글은 받는다
  if (ev.user !== owner || ev.channel !== channel) return { kind: 'none' };   // trust boundary
  let member = null;
  const text = unescape(ev.text).replace(/<@(U[A-Z0-9]+)(?:\|[^>]*)?>/g, (m, u) => (u === self ? ((member ??= ''), '') : members[u] ? ((member ??= members[u]), '') : m)).trim();
  const files = (ev.files || []).filter((f) => f.url_private_download || f.url_private).map((f) => ({ name: f.name || f.title || f.id, url: f.url_private_download || f.url_private }));
  if (!text && !files.length) return { kind: 'none' };
  const r = routeText(ev, text, threadOf, todos, files.length);
  const out = member != null && (r.kind === 'run' || r.kind === 'comment') ? { ...r, member } : r;
  return files.length && r.kind !== 'error' ? { ...out, files } : out;
}
function routeText(ev, text, threadOf, todos, nfiles) {
  if (!ev.thread_ts || ev.thread_ts === ev.ts) return { kind: 'run', prompt: text, ts: ev.ts };
  const thread = threadOf(ev.thread_ts);
  if (thread == null) return { kind: 'error', ts: ev.thread_ts, text: '이 스레드는 대시보드 스레드와 이어져 있지 않아요. 채널에 새 글로 지시해 주세요.' };
  if (/^T\d+\b/i.test(text)) {   // "T12 반려 색이 어두움" = 그 TODO에 답
    const c = parseCommand(text, { todos, files: nfiles });
    if (c.kind === 'answer' || c.kind === 'error') return { ...c, ts: ev.thread_ts };
  }
  return { kind: 'comment', thread, text, ts: ev.thread_ts };
}

// TODO 카드: 보기마다 버튼. 누르면 메모 칸이 있는 창이 뜨고 보내면 답이 된다.
export function todoCard(t, owner) {
  // 보고 확인 TODO는 바로 위에 보고가 있으니 요약·근거 경로를 되풀이하지 않는다
  const rep = t.ref?.startsWith('board/reports/'), desc = rep ? t.desc.replace(/^(작업이 오류로 끝났습니다\. )?보고를 확인해 주세요: [\s\S]*/, '위 보고를 확인해 주세요.') : t.desc;
  const head = `${owner ? `<@${owner}> ` : ''}*T${t.id} ${t.type}* · ${t.by}\n${desc}${t.ref && !rep ? `\n근거: \`${t.ref}\`` : ''}`;
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

// 글에 나온 T12 같은 번호 뒤에 그 TODO 제목을 붙인다(번호만으로는 뭔지 모름). 번호마다 첫 번째만, 제목이 이미 글에 있으면 건너뜀.
// 경로 속 번호(board/uploads/T12/)는 앞뒤 / 로 걸러진다.
export function withTodoTitles(text, all = []) {
  const src = String(text), done = new Set();
  return src.replace(/(?<![\w/.%-])T(\d+)(?![\w/])/g, (m, n) => {
    const t = all.findLast((x) => x.id === Number(n)), title = t && firstLine(t.desc, 40);
    if (!title || done.has(n) || src.includes(title.replace(/…$/, ''))) return m;
    done.add(n);
    return `${m}(${title})`;
  });
}
// 채널 캔버스에 올릴 대표 TODO 판: 대기는 빈 체크박스, 처리한 것은 체크(최근 30개). all = todos.md 전체(파일 순서)
export function todoBoard(all = []) {
  const line = (t) => `- [${t.done ? 'x' : ' '}] **T${t.id} ${t.type}** · ${t.by} — ${firstLine(t.desc, 120)}${t.done ? ` → ${firstLine(t.answer || '완료', 80)}` : ''}`;
  const open = all.filter((t) => !t.done), done = all.filter((t) => t.done).slice(-30).reverse();
  return ['# 대표 TODO', '', `## 대기 ${open.length}건`, '', ...(open.length ? open.map(line) : ['할 일 없음']), '', `## 처리함 (최근 ${done.length}건)`, '', ...done.map(line), '',
    '_대시보드·슬랙 카드에서 답하면 여기 체크가 바뀌어요. 여기서 체크해도 답이 되지는 않아요._'].join('\n');
}

const firstLine = (s, n = 200) => { const l = (String(s || '').split('\n').map((x) => x.trim()).find(Boolean) || '').replace(/^#+\s*/, ''); return l.length > n ? l.slice(0, n - 1) + '…' : l; };

// agents() = 팀원 이름 목록. 토큰이 있는 팀원은 자기 봇으로 말한다.
export function createSlack({ cfg, runDir, root: repo = path.dirname(runDir), todos, allTodos = todos, threadPrompt, onRun, onComment, onAnswer, agents = () => [], log = console.log }) {
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
  // 파일 올리기 API는 form 형식만 받는다
  async function form(method, params, token = cfg.token) {
    const r = await fetch(`https://slack.com/api/${method}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw Object.assign(new Error(`${method}: ${j.error || r.status}`), { code: j.error });
    return j;
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
    self = (await api('auth.test', {}).catch(() => ({}))).user_id || '';
    for (const a of agents()) {
      const token = cfg.bots?.[botKey(a)];
      if (token) await api('auth.test', {}, token).then((j) => (bots[a] = { token, user: j.user_id }), (err) => log(`슬랙 ${a} 봇 토큰이 안 맞아요:`, err.message));
    }
    for (const u of [cfg.owner, ...Object.values(bots).map((b) => b.user)])   // 여럿을 한 번에 초대하면 하나만 이미 있어도 전부 실패
      await api('conversations.invite', { channel: st.channel, users: u }).catch((err) => { if (!['already_in_channel', 'cant_invite_self'].includes(err.code)) log('슬랙 채널 초대 실패:', u, err.message); });
    const n = Object.keys(bots).length;
    if (n) log(`슬랙: 팀원 봇 ${n}명 (${Object.keys(bots).join(', ')})`);
  }
  let self = '';
  const bots = {};   // 팀원 이름 -> { token, user }
  // as = 팀원 이름: 그 팀원 봇이 보낸다(봇이 없으면 PM 봇)
  const post = (body, as) => api('chat.postMessage', { channel: st.channel, unfurl_links: false, ...body }, bots[as]?.token);
  // 대시보드 스레드의 슬랙 머리글. 없으면(슬랙을 켜기 전 스레드, 다시 붙은 실행) 그 스레드의 지시로 만든다.
  async function root(thread, prompt = threadPrompt(thread), extra = '') {
    if (st.threads[thread]) return st.threads[thread];
    const m = await post({ text: firstLine(prompt, 150), blocks: [{ type: 'markdown', text: `**${firstLine(prompt, 150)}**${extra}\n\n${String(prompt || '').slice(0, 2500)}` }] });
    st.threads[thread] = m.ts; save();
    return m.ts;
  }
  const reply = (thread, body, as) => queue(async () => post({ thread_ts: await root(thread), ...body }, as));
  const md = (thread, text, fallback, as) => { const t = withTodoTitles(text, allTodos()); reply(thread, { text: fallback || firstLine(t, 150), blocks: [{ type: 'markdown', text: t.slice(0, 11000) }] }, as); attach(thread, text, as); };
  // 글에 나온 board/ 사진·영상·소리를 그 글 바로 아래에 파일로 올린다(슬랙에서 바로 보고 듣게). 같은 파일은 스레드에 한 번만.
  const sent = new Set();
  let noScope = false;
  function attach(thread, text, as) {   // md는 todos.md 같은 board/ 바로 아래 파일과 보고 전문(이미 글로 올림)은 빼고
    const files = mediaIn(text).filter((rel) => !/^board\/([^/]+|reports\/.*)\.md$/i.test(rel) && !sent.has(`${thread}:${rel}`)).map((rel) => ({ rel, m: mediaFile(repo, rel) }))
      .filter((f) => f.m && statSync(f.m.file).size <= 100e6).slice(0, 10);
    if (!files.length || noScope) return;
    for (const f of files) sent.add(`${thread}:${f.rel}`);
    queue(async () => {
      const up = async (token) => {
        const ids = [];
        for (const f of files) {
          const buf = readFileSync(f.m.file), u = await form('files.getUploadURLExternal', { filename: path.basename(f.rel), length: buf.length }, token);
          const r = await fetch(u.upload_url, { method: 'POST', body: buf });
          if (!r.ok) throw new Error(`파일 올리기 ${r.status}`);
          ids.push({ id: u.file_id, title: f.rel });
        }
        await form('files.completeUploadExternal', { files: JSON.stringify(ids), channel_id: st.channel, thread_ts: await root(thread) }, token);
      };
      try { await up(bots[as]?.token); }
      catch (err) {
        if (err.code !== 'missing_scope') throw err;
        try { if (bots[as]) return await up(); throw err; }   // 팀원 앱에 권한이 없으면 PM 앱으로
        catch (e) { if (e.code !== 'missing_scope') throw e; noScope = true; log('슬랙: 앱에 files:write 권한이 없어 사진·영상·소리를 못 올려요. 슬랙 앱 설정 → OAuth & Permissions에서 files:write를 더하고 다시 설치하세요'); }
      }
    });
  }

  let origin = null;   // 지금 처리 중인 슬랙 메시지: 그 지시·댓글은 슬랙에 다시 쓰지 않는다
  // 실행 시작. thread = 이 실행이 속한 대시보드 스레드, shown = 슬랙에 보일 짧은 글(대시보드 댓글이면 그 댓글)
  function runStarted({ id, thread, prompt, title, from, shown }) {
    const o = origin;
    if (thread === id) {
      if (o) { st.threads[thread] = o; save(); return; }
      return queue(() => root(thread, title ? `${title}\n${prompt}` : prompt, from != null ? `\n_↪ 스레드에서 새 주제로 갈라져 나온 일_` : ''));
    }
    if (o) return;
    md(thread, `${shown ? `대표 댓글: ${shown}` : String(prompt).split('\n\n')[0]}`.slice(0, 2000));   // TODO 답이면 답 줄들
  }
  const progress = (thread, text) => reply(thread, { text: withTodoTitles(text, allTodos()) });
  // PM이 팀원을 부르고 돌려받을 때: 봇이 있는 팀원이면 진짜 멘션으로 맡기고, 끝나면 그 팀원 봇이 결과 첫머리를 답한다.
  // 봇이 있는지는 보낼 차례에 본다(봇 확인은 채널 준비와 같은 줄에서 끝난다).
  const delegated = (thread, a, who, desc) => queue(async () => post({ thread_ts: await root(thread), text: withTodoTitles(bots[a] ? `<@${bots[a].user}> ${desc}` : `${who}에게 맡김 · ${desc}`, allTodos()) }));
  function returned(thread, a, who, mins, result, key) {
    flush(key);
    const r = String(result || '').trim(), text = `${who} 끝 (${mins}분)`;
    queue(async () => post({ thread_ts: await root(thread), ...(bots[a] ? { text, blocks: [{ type: 'markdown', text: `끝났어요 (${mins}분)${r ? `\n\n${r.length > 1500 ? r.slice(0, 1500) + '…' : r}` : ''}` }] } : { text }) }, a));
    attach(thread, r, a);
  }
  // 대시보드 스레드처럼: 팀원의 말은 그 팀원 봇 글로(봇이 없으면 PM 봇이 이름을 붙여), 도구 사용은 그 사람의 마지막 말 아래 한 줄 글 하나를 고쳐 가며.
  // key = 그 팀원을 부른 Agent 호출 id(PM·직접 실행은 'run:<n>'). who = 봇 없을 때 붙일 이름(PM이면 '').
  const tag = (a, who, b) => (bots[a] || !who ? '' : `${b}${who}${b} · `);
  function said(thread, a, who, text, key) {
    flush(key);
    md(thread, tag(a, who, '**') + String(text).trim(), `${who ? who + ': ' : ''}${firstLine(text, 140)}`, a);
  }
  const work = new Map();   // key -> { thread, a, who, n, by, last, ts, timer }
  function worked(thread, key, a, who, label, text) {
    let w = work.get(key);
    if (!w) work.set(key, (w = { thread, a, who, n: 0, by: {}, ts: null, timer: null }));
    w.n++; w.by[label] = (w.by[label] || 0) + 1; w.last = text;
    w.timer ??= setTimeout(() => show(w), 4000);   // 몇 초씩 모아 고친다(슬랙 보내기 한도)
  }
  function show(w) {
    clearTimeout(w.timer); w.timer = null;
    const text = `${tag(w.a, w.who, '*')}작업 ${w.n}건 · ${Object.entries(w.by).map(([k, v]) => `${k} ${v}`).join(' · ')} · 마지막 ${w.last}`.slice(0, 2900);
    const body = { text, blocks: [{ type: 'context', elements: [{ type: 'mrkdwn', text }] }] };   // 작은 회색 글: 대시보드의 접힌 도구 목록처럼
    queue(async () => { if (w.ts) await api('chat.update', { channel: st.channel, ts: w.ts, ...body }, bots[w.a]?.token); else w.ts = (await post({ thread_ts: await root(w.thread), ...body }, w.a)).ts; });
  }
  // 그 사람이 새로 말하거나 끝나면 모아 둔 작업 줄을 지금 내보내고, 다음 작업은 새 줄로
  function flush(key) { const w = work.get(key); if (!w) return; work.delete(key); if (w.timer) show(w); }
  // as = 이 실행을 한 팀원(대표가 멘션으로 직접 시킨 일). 없으면 PM이 보고.
  function report(thread, obj, list, as) {
    const body = String(obj.result || '').trim() || '(보고 글 없음)';
    md(thread, `<@${cfg.owner}> ${obj.is_error ? '**최종 보고 (오류)**' : '**최종 보고**'}\n\n${body}`, `${obj.is_error ? '최종 보고(오류)' : '최종 보고'}: ${firstLine(body, 120)}`, as);
    for (const t of list) notifyTodo(t, thread, true);
  }
  function notifyTodo(t, thread, quiet) {   // quiet = 바로 위 보고에서 이미 대표를 불렀다
    if (st.todos[t.id] || thread == null) return;
    st.todos[t.id] = { thread };
    queue(async () => { const m = await post({ thread_ts: await root(thread), ...todoCard(t, quiet ? '' : cfg.owner) }); st.todos[t.id] = { thread, ts: m.ts }; save(); });   // 버튼 누름은 글을 올린 앱으로 가니 카드는 늘 PM 봇이(팀원 앱은 받기가 없다)
  }
  // 답했거나 지운 TODO 카드는 버튼을 내리고 답을 적는다(대시보드·텔레그램에서 답해도).
  function todoDone(t) {
    const c = st.todos[t.id];
    if (!c?.ts) return;
    delete st.todos[t.id]; save();
    if (t.answer === `취소 (${SUPERSEDED})`) return queue(() => api('chat.delete', { channel: st.channel, ts: c.ts }));   // 뒤 보고 카드만 남긴다
    queue(() => api('chat.update', { channel: st.channel, ts: c.ts, text: `T${t.id} 처리됨`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `~T${t.id} · ${t.type} · ${t.by}~ ${firstLine(t.desc, 150)}\n→ *${t.answer || '완료'}*`.slice(0, 2900) } }] }));
  }
  const closed = (thread) => st.threads[thread] && reply(thread, { text: '대표가 이 스레드를 종료했어요.' });
  const reopened = (thread) => st.threads[thread] && reply(thread, { text: '스레드를 다시 열었어요. 답글을 달면 PM이 이어 가요.' });
  const openTodos = () => Object.keys(st.todos).map(Number);
  // 채널 캔버스(채널 위 탭)에 TODO 판. 내용이 바뀔 때만 고친다. 앱에 canvases:write가 없으면 한 번 알리고 끈다.
  let boardText = '', noCanvas = false;
  function board(all) {
    const text = todoBoard(all);
    if (text === boardText || noCanvas) return;
    boardText = text;
    const doc = { type: 'markdown', markdown: text };
    queue(async () => {
      try {
        if (!st.canvas) {   // 새로 만든 것은 이미 이 내용. 이 앱이 만든 캔버스(slack.json에 저장한 id)만 고친다
          st.canvas = (await api('conversations.canvases.create', { channel_id: st.channel, document_content: doc })).canvas_id;
          return save();
        }
        await api('canvases.edit', { canvas_id: st.canvas, changes: [{ operation: 'replace', document_content: doc }] });
      } catch (err) {
        if (err.code === 'channel_canvas_already_exists' || err.code === 'free_team_canvas_tab_already_exists') { noCanvas = true; return log('슬랙: 채널에 이미 다른 캔버스가 있어 TODO 판을 만들지 않았어요(남의 캔버스는 덮어쓰지 않음). 그 캔버스를 지우면 다음 서버 시작 때 만들어요'); }
        if (err.code === 'missing_scope' || err.code === 'not_allowed_token_type') { noCanvas = true; return log('슬랙: 앱에 canvases:write 권한이 없어 TODO 판(채널 캔버스)을 못 만들어요. 슬랙 앱 설정 → OAuth & Permissions에서 canvases:write를 더하고 다시 설치하세요'); }
        if (err.code === 'canvas_not_found' || err.code === 'invalid_canvas') { st.canvas = null; boardText = ''; save(); }   // 지워진 캔버스: 다음 차례에 새로
        throw err;
      }
    });
  }

  // 대표가 슬랙에 올린 첨부를 받는다 → [{ name, data(base64) }]. 앱에 files:read가 없으면 슬랙이 로그인 HTML을 준다.
  async function download(list) {
    const out = [];
    for (const f of list) {
      if (!/^https:\/\/files\.slack\.com\//.test(f.url)) throw new Error(`첨부 주소가 슬랙 파일이 아님 (${f.name})`);   // 토큰은 슬랙에만
      const r = await fetch(f.url, { headers: { authorization: `Bearer ${cfg.token}` } });
      if (!r.ok || /text\/html/.test(r.headers.get('content-type') || '')) throw new Error(`첨부 「${f.name}」를 못 받았어요. 슬랙 앱 설정 → OAuth & Permissions에서 files:read를 더하고 다시 설치하세요`);
      out.push({ name: f.name, data: Buffer.from(await r.arrayBuffer()).toString('base64') });
    }
    return out;
  }

  // ---------- 받기: Socket Mode ----------
  const seen = new Set();
  async function onEvent(ev) {
    const c = routeSlack(ev, { owner: cfg.owner, channel: st.channel, threadOf, todos: todos(), self, members: Object.fromEntries(Object.entries(bots).map(([a, b]) => [b.user, a])) });
    if (c.kind === 'none') return;
    const say = (text) => queue(() => post({ thread_ts: c.ts, text }, c.member));
    try {
      if (c.kind === 'error') return say(c.text);
      const files = c.files ? await download(c.files) : [];
      if (c.kind === 'answer') { const full = await onAnswer(c.id, c.answer, c.note, files); return say(withTodoTitles(`T${c.id} 처리: ${full}`, allTodos())); }
      origin = c.ts;
      try { c.kind === 'run' ? onRun(c.prompt, c.member, files) : onComment(c.thread, c.text, c.member, files); } finally { origin = null; }
      const got = files.length ? ` (첨부 ${files.length}개)` : '';
      say(c.kind === 'run' && !c.member ? `받았어요${got}. 진행과 보고는 이 스레드에 올려요.` : `받았어요${got}.`);
    } catch (err) { say(`오류: ${err.message}`); }
  }
  async function onInteractive(p, ack) {
    if (p.user?.id !== cfg.owner) return ack();
    if (p.type === 'block_actions') {
      ack();
      const a = p.actions?.[0]; if (!a?.action_id?.startsWith('todo_')) return;
      const { id, answer } = JSON.parse(a.value), t = todos().find((x) => x.id === id);
      if (!t) return queue(() => post({ thread_ts: p.message?.thread_ts || p.message?.ts, text: `T${id}은 이미 처리됐어요.` }));
      return api('views.open', { trigger_id: p.trigger_id, view: answerModal(t, answer, { id, answer, thread: p.message?.thread_ts }) }).catch((err) => log('슬랙 창 열기 실패:', err.message));
    }
    if (p.type === 'view_submission' && p.view?.callback_id === 'todo_answer') {
      const m = JSON.parse(p.view.private_metadata || '{}'), note = p.view.state?.values?.note?.v?.value || '';
      try {
        const full = await onAnswer(m.id, m.answer, note);
        ack();
        if (m.thread) queue(() => post({ thread_ts: m.thread, text: withTodoTitles(`T${m.id} 처리: ${full}`, allTodos()) }));
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
  return { runStarted, progress, delegated, returned, said, worked, flush, report, notifyTodo, todoDone, closed, reopened, openTodos, board };
}

// node tools/slack.mjs apps — 팀원마다 슬랙 앱 매니페스트를 .claude/slack-apps/에 쓰고, 토큰을 넣을 줄을 알려 준다.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2] === 'apps') {
  const root = process.cwd(), cfg = slackConfig(root), { all, missing } = writeApps(root, cfg?.bots);
  if (!all.length) { console.log('.claude/agents/에 팀원이 없어요.'); process.exit(); }
  console.log(`팀원 앱 매니페스트 ${all.length}개: .claude/slack-apps/<팀원>.json`);
  console.log(`슬랙 무료 플랜은 워크스페이스에 앱을 10개까지 설치할 수 있어요. PM 앱 + 팀원 ${all.length}명 = ${all.length + 1}개${all.length + 1 > 10 ? ' — 넘쳐요. 슬랙 유료 플랜이 아니면 일부 팀원만 만드세요(봇이 없는 팀원은 PM 봇이 대신 알려요).' : ''}`);
  if (missing.length) console.log(`토큰이 아직 없는 팀원 — 앱을 만들고 설치한 뒤 .office-slack.env에 넣으세요:\n${missing.map((a) => `  SLACK_BOT_TOKEN_${botKey(a)}=xoxb-...   (.claude/slack-apps/${a}.json)`).join('\n')}`);
  else console.log('모든 팀원 봇 토큰이 있어요. 대시보드 서버를 다시 켜면 채널에 들어와요.');
}
