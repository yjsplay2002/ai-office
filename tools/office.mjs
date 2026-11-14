// AI 오피스 서버: node tools/office.mjs [--replay tools/fixtures/demo-run.jsonl] [--port 4747]
// 대시보드 지시 → `claude -p` (구독) → stream-json → SSE → 3D 오피스.
import http from 'node:http';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, readdirSync, statSync, existsSync, mkdirSync, openSync, readSync, closeSync, rmSync, createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseTodos, answerTodo, dismissTodo, uploadPlan, addRunReport, followUp } from './todos.mjs';
import { usage } from './usage.mjs';
import { mediaFile, byteRange } from './files.mjs';
import { telegramConfig, createTelegram } from './telegram.mjs';
import { slackConfig, createSlack } from './slack.mjs';
import { loadLog, lastRun, KEEP_LINES, SEND_LINES, todoThread, linkAnswers, ANSWER_HEAD, keepRuns, tail } from './eventlog.mjs';
import { readAgent, editAgent, readPm, editPm, pmArgs } from './staff.mjs';
import { updateTools } from './update.mjs';
import { judgePrompt, parseVerdict } from './topic.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const board = path.join(root, 'board');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const replay = arg('--replay');
// 감독 프로세스: 서버는 자식으로 돈다. 띄울 때마다 설치된 플러그인의 tools/를 이 프로젝트에 맞추고(플러그인 업데이트 반영),
// 대시보드 재시작 버튼(자식 종료 코드 75)이면 같은 포트로 다시 띄운다. Ctrl+C는 둘 다에 간다.
const RESTART = 75;
if (!process.env.OFFICE_CHILD) {
  const argv = process.argv.slice(1).concat(arg('--port') ? [] : ['--port', String(await freePort(4747))]);
  const run = () => {
    if (!existsSync(path.join(root, '.claude-plugin'))) {   // 플러그인 저장소 자체에서는 맞추지 않는다(그곳이 원본)
      try {
        const u = updateTools(here);
        if (u) console.log(`플러그인 ${u.version} 반영: tools/ ${u.changed.join(', ') || '(바뀐 파일 없음)'}`);
      } catch (e) { console.error('플러그인 tools/ 맞추기 실패(지금 코드로 계속):', e.message); }
    }
    spawn(process.execPath, argv, { stdio: 'inherit', env: { ...process.env, OFFICE_CHILD: '1' } })
      .on('exit', (code) => (code === RESTART ? run() : process.exit(code ?? 1)));
  };
  run();
  await new Promise(() => {});   // 아래는 자식(서버)만 실행한다
}
// 한 PC에 팀(프로젝트)이 여럿일 수 있어, --port가 없으면 4747부터 비어 있는 포트를 쓴다.
const port = arg('--port') ? Number(arg('--port')) : await freePort(4747);
// shortcut: 확인과 실제 listen 사이에 다른 프로세스가 끼어들 수 있음, 그때는 아래 listen 오류로 종료되니 다시 실행.
async function freePort(p) {
  while (!(await new Promise((ok) => { const s = net.createServer().once('error', () => ok(false)).listen(p, '127.0.0.1', () => s.close(() => ok(true))); }))) p++;
  return p;
}

const runs = new Map();   // run id -> { pid, poll } (or replay { timer }). Several run at once.
// Each claude run is a detached process writing to .office-runs/<id>.jsonl, so this server can restart
// without killing or blocking it: on boot it re-attaches to every run still listed there.
const runDir = path.join(root, '.office-runs');
mkdirSync(runDir, { recursive: true });
// 대시보드 기록: 방송한 줄은 모두 history.jsonl에도 남겨 서버를 다시 켜도 대화 내역·보고함·히스토리 카드가 돌아온다.
// 부팅 때 7일·5000줄로 줄이고, 다시 붙는 실행(파일이 남은 실행)의 옛 줄은 지운다 — 그 실행이 처음부터 다시 보내므로 중복이 안 생긴다.
const histFile = path.join(runDir, 'history.jsonl');
const reattach = readdirSync(runDir).filter((f) => /^\d+\.json$/.test(f))
  .map((f) => { try { return JSON.parse(readFileSync(path.join(runDir, f), 'utf8')); } catch { return null; } }).filter(Boolean);
const todosFile = path.join(board, 'todos.md');
const todos = () => (existsSync(todosFile) ? parseTodos(readFileSync(todosFile, 'utf8')) : []);
// 옛 기록의 TODO 답 실행도 원래 작업 스레드로 옮기고(부팅마다 다시 계산), 열린 TODO가 걸린 스레드는 7일·5000줄이 지나도 남긴다.
// shortcut: keep은 부팅 때만 계산. 서버를 며칠씩 켜 두면 그사이 생긴 TODO의 스레드는 다음 부팅 때부터 지켜진다.
let history = loadLog(existsSync(histFile) ? readFileSync(histFile, 'utf8') : '', { drop: new Set(reattach.map((m) => m.id)), days: Infinity, max: Infinity });
try { history = linkAnswers(history, todos()); } catch {}
let keep = new Set();
try { keep = keepRuns(history, todos()); } catch {}
history = loadLog(history.join('\n'), { keep });
writeFileSync(histFile, history.length ? history.join('\n') + '\n' : '');
let nextRun = Math.max(lastRun(history), ...reattach.map((m) => m.id)) + 1;   // 옛 기록의 실행 번호와 겹치지 않게
const clients = new Set();

function broadcast(obj) {
  const line = JSON.stringify({ _t: Date.now(), ...obj });   // _t = when it happened, so replayed history keeps real times
  history.push(line);
  if (history.length > KEEP_LINES * 1.2) history = tail(history, KEEP_LINES, keep);   // 파일은 다음 부팅 때 줄인다
  try { appendFileSync(histFile, line + '\n'); } catch {}
  for (const res of clients) res.write(`data: ${line}\n\n`);
}
const office = (o) => broadcast({ type: '_office', ...o });
const busy = () => runs.size > 0;

// Every instruction / TODO answer starts its own PM run immediately — no queue.
// thread = the run that started the dashboard thread this run belongs to (a CEO comment); resume = that thread's PM session.
// title: 목록에 보일 작업 제목(없으면 프롬프트에서), from: 새 주제로 갈라져 나온 원래 스레드, shown: 슬랙에 보일 짧은 글(댓글)
function startRun(prompt, { thread, resume, title, from, shown } = {}) {
  const id = nextRun++, before = todoIds();
  slack?.runStarted({ id, thread: thread ?? id, prompt, title, from, shown });
  if (replay) {
    const send = (obj) => broadcast({ ...obj, _run: id });
    runs.set(id, null);
    send({ type: '_office', state: 'running', runs: runs.size, prompt, thread, title, from });
    const lines = readFileSync(path.resolve(root, replay), 'utf8').split('\n').filter(Boolean);
    let i = 0;
    const tick = () => {
      if (!runs.has(id)) return;
      if (i >= lines.length) { runs.delete(id); return send({ type: '_office', state: busy() ? 'running' : 'idle', runs: runs.size, ended: true }); }
      const obj = JSON.parse(lines[i++]);
      send(obj);
      if (obj.type === 'result') reportTodo(id, prompt, obj, before);
      runs.set(id, { timer: setTimeout(tick, 700) });
    };
    return tick();
  }
  // Prompt goes through stdin so Korean text and quotes never touch the shell.
  const base = path.join(runDir, String(id));
  const out = openSync(base + '.jsonl', 'a'), err = openSync(base + '.err', 'a');
  const shell = !claudeExe && process.platform === 'win32', q = (a) => (shell ? `"${a}"` : a);   // cmd needs the quotes
  // 토큰·안전: 개인 MCP 커넥터(메일·슬랙·드라이브 등)와 전역 스킬은 bypassPermissions 실행에 싣지 않는다.
  // 그래서 대시보드에서 도는 브라우저 담당은 CLI 브라우저 도구(Bash)를 써야 한다.
  const child = spawn(claudeExe || 'claude', ['-p', '--output-format', 'stream-json', '--verbose', '--strict-mcp-config', '--disable-slash-commands', '--permission-mode', 'bypassPermissions', ...(resume ? ['--resume', resume] : []), ...pmArgs(pmConf()),   // PM 모델·노력: .claude/ai-office.json(직원 관리), 실행마다 다시 읽음
    '--allowedTools', q('WebSearch,WebFetch,Bash(git add:*),Bash(git commit:*),Bash(git status:*),Bash(git log:*),Bash(git diff:*)'),
    // Telegram plugin tools are blocked: the office reaches its owner only through its own bot (tools/tg-send.mjs).
    '--disallowedTools', q('mcp__plugin_telegram_telegram')],
    { cwd: root, shell, detached: true, windowsHide: true, stdio: ['pipe', out, err], env: { ...process.env, OFFICE_RUN: '1' } });
  closeSync(out); closeSync(err);
  child.on('error', () => {});   // a spawn failure shows up as an already-dead pid below
  child.stdin.end(prompt);
  child.unref();
  const meta = { id, pid: child.pid, prompt, t: Date.now(), before, thread, title, from };
  writeFileSync(base + '.json', JSON.stringify(meta));
  attach(meta);
}

// The npm claude.cmd shim drops its output when detached on Windows, so run the real exe when it can be found.
const claudeExe = process.platform !== 'win32' ? null : (process.env.PATH || '').split(path.delimiter)
  .map((d) => path.join(d, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')).find((p) => existsSync(p)) || null;
const RUN_FILES = ['.json', '.jsonl', '.err', '.jsonl.t', '.err.t'];
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// Follow a run's output files until its process is gone, then finish it and delete the files.
// shortcut: liveness is by pid only; a pid reused while the server was down would look alive until it exits.
function attach({ id, pid, prompt, t: started, before = [], thread, title, from }) {
  const base = path.join(runDir, String(id));
  const send = (obj) => broadcast({ ...obj, _run: id });
  // 중간 보고: PM이 팀원을 부르고 돌려받을 때마다 텔레그램에 무음으로 알린다. LLM을 안 써서 토큰이 들지 않는다.
  const calls = new Map();
  const progress = (obj, ts) => {
    if (obj.parent_tool_use_id) return;   // 팀원 안쪽 도구 호출은 생략
    for (const c of obj.message?.content || []) {
      if (obj.type === 'assistant' && c.type === 'tool_use' && (c.name === 'Agent' || c.name === 'Task')) {
        const who = agents().find((a) => a.name === c.input?.subagent_type)?.title || c.input?.subagent_type || '임시 지원';
        if (!c.input?.run_in_background) calls.set(c.id, { who, ts });
        tg?.progress(`▶️ ${who} 시작 — ${c.input?.description || ''}`);
        slack?.progress(thread ?? id, `▶️ ${who} 시작 — ${c.input?.description || ''}`);
      }
      if (obj.type === 'user' && c.type === 'tool_result' && calls.has(c.tool_use_id)) {
        const { who, ts: t0 } = calls.get(c.tool_use_id); calls.delete(c.tool_use_id);
        tg?.progress(`☑️ ${who} 끝 (${Math.max(1, Math.round((ts - t0) / 60000))}분)`);
        slack?.progress(thread ?? id, `☑️ ${who} 끝 (${Math.max(1, Math.round((ts - t0) / 60000))}분)`);
      }
    }
  };
  // <file>.t keeps one timestamp per line, so a restarted server replays lines with the time they were first seen.
  const tails = ['.jsonl', '.err'].map((ext) => ({ file: base + ext, err: ext === '.err', pos: 0, buf: Buffer.alloc(0), k: 0,
    times: existsSync(base + ext + '.t') ? readFileSync(base + ext + '.t', 'utf8').split(/\s+/).filter(Boolean).map(Number) : [] }));
  const pump = () => {
    for (const t of tails) {
      if (!existsSync(t.file)) continue;
      const size = statSync(t.file).size;
      if (size <= t.pos) continue;
      const fd = openSync(t.file, 'r'), chunk = Buffer.alloc(size - t.pos);
      readSync(fd, chunk, 0, chunk.length, t.pos); closeSync(fd);
      t.pos = size;
      t.buf = Buffer.concat([t.buf, chunk]);
      let n;
      while ((n = t.buf.indexOf(10)) >= 0) {   // split on bytes so a UTF-8 char is never cut in half
        const l = t.buf.subarray(0, n).toString('utf8').trim(); t.buf = t.buf.subarray(n + 1);
        if (!l) continue;
        let ts = t.times[t.k++];
        const fresh = ts == null;   // first time this line is seen (not a re-read after a restart)
        if (fresh) { ts = Date.now(); t.times.push(ts); appendFileSync(t.file + '.t', `${ts}\n`); }
        if (t.err) { send({ type: '_office', log: l, _t: ts }); continue; }
        let obj;
        try { obj = JSON.parse(l); } catch { send({ type: '_office', log: l, _t: ts }); continue; }
        send({ ...obj, _t: ts });
        if (fresh) progress(obj, ts);
        // 직원별 토큰은 이 오피스가 띄운 세션만 센다(같은 폴더의 다른 Claude 작업과 섞이지 않게). tools/usage.mjs가 읽는다.
        if (fresh && obj.type === 'system' && obj.subtype === 'init' && obj.session_id) appendFileSync(path.join(runDir, 'sessions.txt'), obj.session_id + '\n');
        if (fresh && obj.type === 'result') {   // 텔레그램도 한 번만: 최종 보고를 그 보고가 실린 TODO(버튼 포함)와 한 메시지로
          const ids = reportTodo(id, prompt, obj, before), msg = `${obj.is_error ? '⚠️ 최종 보고 (오류)' : '✅ 최종 보고'}\n${String(obj.result || '').trim().slice(0, 600)}`;
          const list = todos().filter((t) => ids.includes(t.id));
          for (const t of list) seenTodos?.add(t.id);
          if (list.length) list.forEach((t, i) => tg?.notifyTodo(t, i ? '' : msg)); else tg?.notify(msg);
          slack?.report(thread ?? id, obj, list);   // 슬랙은 그 스레드에 보고, 이어서 TODO 카드
        }
      }
    }
  };
  runs.set(id, { pid });
  send({ type: '_office', state: 'running', runs: runs.size, prompt, thread, title, from, _t: started });
  const poll = setInterval(() => {
    const live = alive(pid);   // checked before reading, so everything written before exit is read
    pump();
    if (live) return;
    clearInterval(poll);
    if (!runs.has(id)) return;
    runs.delete(id);
    send({ type: '_office', state: busy() ? 'running' : 'idle', runs: runs.size, ended: true });
    for (const ext of RUN_FILES) rmSync(base + ext, { force: true });
  }, 500);
  runs.get(id).poll = poll;
}

// only = run ids to stop (one dashboard thread); none = every run.
function cancel(only) {
  const ids = [...runs.keys()].filter((id) => !only || only.includes(id));
  for (const id of ids) {
    const c = runs.get(id);
    runs.delete(id);
    if (c?.timer) clearTimeout(c.timer);
    else if (c) {
      clearInterval(c.poll);
      if (process.platform === 'win32') execFile('taskkill', ['/pid', String(c.pid), '/T', '/F']); // shell:true needs a tree kill
      else try { process.kill(-c.pid); } catch {}   // detached: kill the whole group
      for (const ext of RUN_FILES) rmSync(path.join(runDir, id + ext), { force: true });
    }
    broadcast({ type: '_office', _run: id, ended: true, cancelled: true, state: busy() ? 'running' : 'idle', runs: runs.size });
  }
  if (!only) office({ state: 'idle', runs: 0, log: `취소됨 — 작업 ${ids.length}건 모두 중단` });
  return ids.length;
}

// A dashboard thread = a CEO instruction's run plus the runs started by comments on it. Read back from the event log.
function threadInfo(thread) {
  const ids = new Set([thread]);
  let prompt = '', session = null;
  for (const l of history) {
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.type === '_office' && o.prompt && (o._run === thread || o.thread === thread) && !prompt) prompt = o.prompt;   // 연 지시가 잘렸으면 남은 가장 이른 실행
    if (o.type === '_office' && o.prompt && o.thread === thread) ids.add(o._run);
    if (o.type === 'system' && o.subtype === 'init' && !o.parent_tool_use_id && ids.has(o._run)) session = o.session_id;
  }
  // The session id goes on the command line (shell on Windows), so only a plain UUID passes.
  return { ids: [...ids], prompt, session: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session || '') ? session : null };
}
// CEO comment on a thread: continues the thread's PM session when no run of it is still going; otherwise a fresh run quoting the instruction.
function comment(thread, text) {
  if (!Number.isInteger(thread) || !text?.trim()) throw new Error('댓글이 비어 있음');
  const th = threadInfo(thread);
  if (!th.prompt) throw new Error('스레드를 찾을 수 없음(기록이 지워졌을 수 있음)');
  const live = th.ids.some((id) => runs.has(id));
  if (th.session && !live) return startRun(text.trim(), { thread, resume: th.session, shown: text.trim() });
  startRun(`대표가 아래 지시의 스레드에 댓글을 달았습니다. 지시의 맥락에서 댓글을 처리해.

[원래 지시]
${th.prompt}

[대표 댓글]
${text.trim()}`, { thread, shown: text.trim() });
}

// 직원 관리: PM 설정 파일과 팀원 머리말. 서버는 파일만 고치고 커밋하지 않는다.
const pmFile = path.join(root, '.claude', 'ai-office.json');
const pmConf = () => readPm(existsSync(pmFile) ? readFileSync(pmFile, 'utf8') : '');
function staff() {
  const pm = pmConf();
  return [{ id: 'pm', role: 'PM', name: pm.name, desc: '메인 세션. 대표 지시를 받아 팀원에게 나눠 맡긴다.', model: pm.model, effort: pm.effort },
    ...agents().map((a) => readAgent(readFileSync(a.file, 'utf8'), a.name))];
}
// change = { id, model, effort, name }; id must be pm or an agent listed in .claude/agents (the file path comes from that listing).
function saveStaff({ id, model, effort, name }) {
  const change = { model, effort, name };
  if (id === 'pm') { mkdirSync(path.dirname(pmFile), { recursive: true }); writeFileSync(pmFile, editPm(existsSync(pmFile) ? readFileSync(pmFile, 'utf8') : '', change)); }
  else {
    const a = agents().find((x) => x.name === id);
    if (!a) throw new Error('없는 직원');
    writeFileSync(a.file, editAgent(readFileSync(a.file, 'utf8'), change));
  }
  office({ log: `직원 관리: ${id} 설정을 바꿈` });
  return staff().find((x) => x.id === id);
}

function agents() {
  const dir = path.join(root, '.claude', 'agents');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => {
    const fm = (readFileSync(path.join(dir, f), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';
    const get = (k) => (fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm')) || [])[1]?.trim() || '';
    return { file: path.join(dir, f), name: get('name') || f.replace(/\.md$/, ''), title: get('description').split('.')[0], model: get('model'), effort: get('effort') };
  });
}

function listBoard(dir = board) {
  if (!existsSync(dir)) return [];   // board/가 아직 없는 새 팀
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return listBoard(p);
    return [{ path: path.relative(root, p).replace(/\\/g, '/'), mtime: statSync(p).mtimeMs }];
  }).sort((a, b) => b.mtime - a.mtime);
}

const todoIds = () => { try { return todos().map((t) => t.id); } catch { return []; } };

// 실행이 최종 보고로 끝나면 보고 전문을 board/reports/에 남기고, 그 실행이 올린 TODO에 붙이거나(없으면) '확인'을 올린다(addRunReport).
// 오류로 끝나도 올린다. 취소된 실행은 결과가 없어 올리지 않음. -> 보고가 실린 TODO 번호들
// board/가 없는 폴더(플러그인 저장소에서 리플레이 등)에는 쓰지 않는다.
function reportTodo(run, prompt, obj, before = []) {
  if (!existsSync(board)) return [];
  try {
    const d = new Date(), day = d.toLocaleDateString('sv'), hm = d.toTimeString().slice(0, 8).replace(/:/g, '');
    const rel = `board/reports/${day}-${hm}-run${run}.md`, text = String(obj.result || '').trim();
    mkdirSync(path.join(board, 'reports'), { recursive: true });
    const ask = String(prompt || '').split('\n')[0].slice(0, 300);
    writeFileSync(path.join(root, rel), `# 최종 보고 · 대시보드 실행 ${run}\n\n- 시각: ${day} ${d.toTimeString().slice(0, 5)}\n- 결과: ${obj.is_error ? '오류' : '완료'}\n- 지시: ${ask}\n\n---\n\n${text}\n`);
    const r = addRunReport(existsSync(todosFile) ? readFileSync(todosFile, 'utf8') : '', { summary: text, ref: rel, error: !!obj.is_error, before });   // 다른 PM 세션도 쓰므로 바로 직전에 읽는다
    writeFileSync(todosFile, r.text);
    office({ log: r.check ? `보고 확인 TODO T${r.ids[0]} 추가` : `보고를 T${r.ids.join(', T')}에 붙임` });
    return r.ids;
  } catch (err) { office({ log: '보고 TODO 추가 실패: ' + err.message }); return []; }
}

// 대표가 TODO를 지운다(답 없이 닫음, 다음 실행 없음). why = 지운 까닭(todos.md의 답 줄에 남는다)
function dismiss(ids, why) {
  if (!ids.length) return;
  const today = new Date().toLocaleDateString('sv');
  let text = readFileSync(todosFile, 'utf8');
  for (const id of ids) text = dismissTodo(text, id, why, today).text;
  writeFileSync(todosFile, text);
  office({ log: `TODO T${ids.join(', T')} 지움 (${why})` });
}
// 스레드 종료: 그 스레드에서 나온 열린 TODO와, 아직 PM에게 안 넘어간 그 스레드의 답도 함께 닫는다(남으면 60초 뒤 스레드가 다시 열린다)
function closeThreadTodos(thread) {
  const all = todos(), of = (t) => todoThread(t, history, all) === thread;
  pendingAnswers = pendingAnswers.filter((a) => !of(a.todo));
  closedNow.add(thread);   // 주제 판단을 기다리는 그 스레드의 답도 버린다
  dismiss(all.filter((t) => !t.done && of(t)).map((t) => t.id), '스레드 종료');
}

function checkUploads(dir, files) {
  const ups = uploadPlan(dir, files);
  if (ups.reduce((n, u) => n + u.buf.length, 0) > 50e6) throw new Error('첨부는 합쳐서 50MB까지');
  return ups;
}
const saveUploads = (ups) => { for (const u of ups) { mkdirSync(path.dirname(path.join(root, u.rel)), { recursive: true }); writeFileSync(path.join(root, u.rel), u.buf); } };

function submitTodo(id, answer, note, files) {
  const today = new Date().toLocaleDateString('sv');   // 로컬 날짜(UTC면 한국 아침이 전날로 찍힘)
  const ups = checkUploads(`T${id}`, files);
  if (ups.length) note = [note?.trim(), `첨부: ${ups.map((u) => u.rel).join(', ')}`].filter(Boolean).join(' — ');
  const r = answerTodo(readFileSync(todosFile, 'utf8'), id, answer || '', note, today);
  saveUploads(ups);
  writeFileSync(todosFile, r.text);
  const title = r.todo.desc.split('\n')[0];
  if (r.todo.type === '결정' || r.todo.type === '승인') appendFileSync(path.join(board, 'decisions.md'), `${today} — T${id} ${title} — ${r.full} (대시보드)\n`);
  office({ log: `TODO T${id} 처리: ${r.full}` });
  // 토큰(11-06 점검): 답이 몰려 오면 PM 세션 하나로 묶는다. 마지막 답 뒤 60초 동안 새 답이 없으면 시작.
  // shortcut: 대기 중 서버가 재시작되면 묶음이 사라진다(답 자체는 todos.md에 저장됨). 자주 생기면 runDir에 대기 목록을 저장.
  const line = followUp(r.todo, r.full);
  if (!line) return r.full;   // 확인 TODO를 '종료'로 닫음: 이어서 할 일 없음
  pendingAnswers.push({ line, todo: r.todo });
  clearTimeout(answerTimer);
  answerTimer = setTimeout(flushAnswers, ANSWER_BATCH_MS);
  return r.full;
}

const ANSWER_BATCH_MS = 60e3;
let pendingAnswers = [], answerTimer = null;
function flushAnswers() {
  const list = pendingAnswers; pendingAnswers = [];
  // 스레드 = 작업 하나: 답은 그 TODO를 올린 작업의 스레드에서 이어 간다(작업별로 묶음). 출처를 모르는 답만 새 스레드.
  // 답이 그 스레드 주제와 다른 새 일을 시키면(작은 모델이 판단) 새 스레드로 뗀다. 판단이 실패하면 원래 스레드.
  const groups = new Map();
  for (const a of list) { const th = todoThread(a.todo, history, todos()); groups.set(th, [...(groups.get(th) || []), a.line]); }
  const prompt = (lines) => `${ANSWER_HEAD}\n${lines.join('\n')}\n\n` +
    'board/todos.md와 근거 파일을 확인하고, 이 답들을 반영해 남은 작업을 이어서 진행해. 서로 관계없는 답은 팀원을 동시에 불러 처리해. 대표가 할 일이 새로 생기면 todos.md에 형식대로 추가해.';
  for (const [thread, lines] of groups) {
    if (thread == null) { startRun(prompt(lines)); continue; }
    closedNow.delete(thread);
    judgeTopic(threadInfo(thread).prompt, lines).then((v) => {
      if (closedNow.has(thread)) return;   // 판단하는 사이 대표가 스레드를 종료함
      const fresh = lines.filter((_, i) => v?.fresh.includes(i)), stay = lines.filter((_, i) => !v?.fresh.includes(i));
      if (fresh.length) { startRun(prompt(fresh), { title: v.title || undefined, from: thread }); office({ log: `새 주제라 새 스레드로: ${v.title || fresh.length + '건'}` }); }
      if (!stay.length) return;
      const th = threadInfo(thread);
      startRun(prompt(stay), { thread, resume: th.ids.some((id) => runs.has(id)) ? undefined : th.session || undefined });
    });
  }
}
const closedNow = new Set();
// 토큰(11-14 측정): haiku 한 번에 약 $0.002(입력 대부분은 캐시된 시스템 프롬프트). 프로젝트 CLAUDE.md를 싣지 않게 임시 폴더에서 돈다.
function judgeTopic(subject, lines) {
  if (replay || !subject) return Promise.resolve(null);
  return new Promise((done) => {
    const child = spawn(claudeExe || 'claude', ['-p', '--model', 'haiku', '--output-format', 'text', '--strict-mcp-config', '--disable-slash-commands'],
      { cwd: os.tmpdir(), shell: !claudeExe && process.platform === 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => child.kill(), 90e3);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => {});
    child.on('close', () => { clearTimeout(timer); let v = null; try { v = parseVerdict(out, lines.length); } catch {} done(v); });
    child.stdin.end(judgePrompt(subject, lines));
  });
}

// A new CEO instruction (dashboard or Telegram). files = [{ name, data(base64) }].
function startInstruction(prompt, files = []) {
  if (!prompt?.trim()) throw new Error('지시가 비어 있음');
  const ups = checkUploads(`run-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`, files);
  saveUploads(ups);
  startRun(prompt.trim() + (ups.length ? `\n\n대표 첨부 파일: ${ups.map((u) => u.rel).join(', ')}` : ''));
}

// Only files inside board/ are ever served.
function safeBoard(rel) {
  const p = path.resolve(root, rel);
  return p.startsWith(board + path.sep) && existsSync(p) ? p : null;
}

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((ok) => { let s = ''; req.on('data', (d) => (s += d)); req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { ok({}); } }); });

// ---------- 대표 텔레그램: 알림 + 답장·지시·첨부 (tools/telegram.mjs) ----------
const tgCfg = replay ? null : telegramConfig(root);
const officeUrl = tgCfg?.url || process.env.OFFICE_URL || `http://127.0.0.1:${port}`;
const tg = tgCfg && createTelegram({
  cfg: tgCfg, url: officeUrl, runDir, todos: () => todos().filter((t) => !t.done),
  status: () => (runs.size ? `작업 ${runs.size}건 진행 중` : '진행 중인 작업 없음') + ` · 열린 TODO ${todos().filter((t) => !t.done).length}건\n${officeUrl}`,
  onRun: (prompt, files) => startInstruction(`${prompt}\n\n(텔레그램으로 받은 지시)`, files),
  onAnswer: (id, answer, note, files) => submitTodo(id, answer, note, files),
  onCancel: () => { const n = runs.size; cancel(); return n; },
});
// ---------- 대표 슬랙: 오피스 채널에 스레드 그대로 + 지시·댓글·TODO 답 받기 (tools/slack.mjs) ----------
// 토큰 파일이 커밋되지 않게: 이 기능 전에 init한 프로젝트의 .gitignore에도 넣는다(PM은 git add를 할 수 있다).
const gi = path.join(root, '.gitignore');
if (existsSync(path.join(root, '.office-slack.env')) && !(existsSync(gi) ? readFileSync(gi, 'utf8') : '').split(/\r?\n/).includes('.office-slack.env')) {
  const have = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  appendFileSync(gi, (have && !have.endsWith('\n') ? '\n' : '') + '.office-slack.env\n');
}
const slackCfg = slackConfig(root);
const slack = slackCfg && createSlack({
  cfg: slackCfg, runDir, todos: () => todos().filter((t) => !t.done), threadPrompt: (th) => threadInfo(th).prompt,
  onRun: (prompt) => startInstruction(`${prompt}\n\n(슬랙으로 받은 지시)`),
  onComment: (thread, text) => comment(thread, text),
  onAnswer: (id, answer, note) => submitTodo(id, answer, note, []),
});
// New open TODOs (by id) since the server started. Existing ones at boot are not re-announced.
let seenTodos = null;
function checkTodos() {
  let open;
  try { open = todos().filter((t) => !t.done); } catch { return; }
  const fresh = seenTodos ? open.filter((t) => !seenTodos.has(t.id)) : [];
  seenTodos = new Set([...(seenTodos || []), ...open.map((t) => t.id)]);
  for (const t of fresh) tg?.notifyTodo(t);
  if (!slack) return;
  const all = todos();
  for (const t of fresh) slack.notifyTodo(t, todoThread(t, history, all));
  for (const id of slack.openTodos()) {   // 대시보드·텔레그램에서 답한 TODO의 슬랙 카드도 닫는다
    if (open.some((t) => t.id === id)) continue;
    const t = all.findLast((x) => x.id === id);
    if (t) slack.todoDone(t);
  }
}
checkTodos();
setInterval(checkTodos, 5000);
console.log(tg ? '텔레그램: 오피스 봇으로 알림 + 답장·지시 받기' : '텔레그램: 꺼짐 (.office-telegram.env에 오피스 전용 봇 토큰 필요)');
console.log(slack ? '슬랙: 연결 중…' : '슬랙: 꺼짐 (.office-slack.env 필요, README의 슬랙 연동 참고)');

// Re-attach to runs that kept going while this server was down (finished ones are read to the end, then closed).
for (const meta of reattach) attach(meta);

// 대시보드의 재시작 버튼: 포트를 비우고 종료 코드 75로 끝나면 감독 프로세스가 (플러그인 tools/를 맞춘 뒤) 다시 띄운다.
// 실행 중인 claude는 분리된 프로세스라 계속 돌고, 새 서버가 부팅 때 다시 붙는다.
function restart() {
  server.close(() => process.exit(RESTART));
  server.closeAllConnections();   // SSE 연결이 남아 있으면 close가 끝나지 않는다
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/' || p === '/map.mjs') {
      res.writeHead(200, { 'content-type': p === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' });
      if (p !== '/') return res.end(readFileSync(path.join(here, 'map.mjs')));
      // 탭 제목에 프로젝트 폴더 이름을 넣어 여러 팀 대시보드를 구분한다.
      const team = path.basename(root).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
      return res.end(readFileSync(path.join(here, 'office.html'), 'utf8').replace('<title>AI 오피스</title>', `<title>AI 오피스 · ${team}</title>`));
    }
    // 3D 캐릭터·소품 모델(tools/chars/*.glb). 이름은 영문·숫자·-만
    const glb = /^\/chars\/([a-z0-9-]+)\.glb$/.exec(p);
    if (glb) {
      const f = path.join(here, 'chars', glb[1] + '.glb');
      if (!existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'model/gltf-binary', 'cache-control': 'no-cache' });
      return res.end(readFileSync(f));
    }
    if (p === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const recent = tail(history, SEND_LINES, keep);   // shortcut: 새 화면에는 최근 3000줄만. 더 옛날 대화가 필요해지면 위로 스크롤할 때 더 받기
      res.write(`data: ${JSON.stringify({ type: '_office', history: recent.length })}\n\n`);
      for (const l of recent) res.write(`data: ${JSON.stringify({ ...JSON.parse(l), _history: true })}\n\n`);
      // 기록 끝에 지금 상태: 기록 속 옛 실행(서버가 꺼진 사이 사라진 것 포함)은 화면에서 끝난 것으로 정리된다
      res.write(`data: ${JSON.stringify({ type: '_office', state: busy() ? 'running' : 'idle', runs: runs.size, live: [...runs.keys()], _history: true })}\n\n`);
      clients.add(res);
      return req.on('close', () => clients.delete(res));
    }
    if (p === '/api/usage') return json(res, 200, usage(root));
    if (p === '/api/agents') return json(res, 200, agents().map(({ file, ...a }) => a));
    if (p === '/api/staff' && req.method === 'GET') return json(res, 200, staff());
    if (p === '/api/board') { const all = todos(); return json(res, 200, { files: listBoard(), todos: all.map((t) => (t.done ? t : { ...t, thread: todoThread(t, history, all) })), runs: runs.size }); }
    if (p === '/api/file') {
      const f = safeBoard(url.searchParams.get('path') || '');
      if (!f) return json(res, 404, { error: 'not found' });
      const img = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }[path.extname(f).toLowerCase()];
      res.writeHead(200, { 'content-type': img || 'text/plain; charset=utf-8' });
      return res.end(readFileSync(f));
    }
    if (p.startsWith('/files/')) {   // 결과물 미리보기 (tools/files.mjs가 허용한 것만)
      let rel; try { rel = decodeURIComponent(p.slice(7)); } catch { return json(res, 400, { error: 'bad path' }); }
      const m = mediaFile(root, rel);
      if (!m) return json(res, 404, { error: 'not found' });
      const size = statSync(m.file).size, range = byteRange(req.headers.range, size);
      const h = { 'content-type': m.type, 'x-content-type-options': 'nosniff', 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
      // HTML·SVG scripts run in an opaque origin, so they cannot read the dashboard API as this origin.
      if (/html|svg/.test(m.type)) h['content-security-policy'] = 'sandbox allow-scripts';
      if (range === false) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
      res.writeHead(range ? 206 : 200, { ...h, 'content-length': range ? range.end - range.start + 1 : size, ...(range && { 'content-range': `bytes ${range.start}-${range.end}/${size}` }) });
      return req.method === 'HEAD' ? res.end() : createReadStream(m.file, range || {}).pipe(res);
    }
    // Sandboxed /files/ pages and other sites send cross-site requests; only the dashboard itself may POST.
    if (req.method === 'POST' && (req.headers['sec-fetch-site'] || 'same-origin') !== 'same-origin') return json(res, 403, { error: 'forbidden' });
    if (req.method === 'POST' && p === '/api/run') {
      const { prompt, files } = await body(req);
      try { startInstruction(prompt, Array.isArray(files) ? files : []); } catch (err) { return json(res, 400, { error: err.message }); }
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/restart') { json(res, 200, { ok: true }); return setTimeout(restart, 100); }
    if (req.method === 'POST' && p === '/api/cancel') {
      const { thread } = await body(req);
      if (thread == null) { cancel(); return json(res, 200, { ok: true }); }
      if (!Number.isInteger(thread)) return json(res, 400, { error: 'thread' });
      cancel(threadInfo(thread).ids);
      office({ closed: thread });   // the thread shows as 종료 from now on (kept in the event log)
      slack?.closed(thread);
      try { closeThreadTodos(thread); } catch (err) { office({ log: 'TODO 정리 실패: ' + err.message }); }
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/reopen') {   // 종료한 스레드 다시 열기: 표시만 바꾼다(지운 TODO는 그대로). 댓글을 달면 PM이 이어 간다
      const { thread } = await body(req);
      if (!Number.isInteger(thread)) return json(res, 400, { error: 'thread' });
      office({ reopened: thread });
      slack?.reopened(thread);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/comment') {
      const { thread, text } = await body(req);
      try { comment(thread, String(text ?? '')); } catch (err) { return json(res, 400, { error: err.message }); }
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/staff') {
      const b = await body(req), str = (v) => (v === undefined ? undefined : String(v));
      try { return json(res, 200, saveStaff({ id: String(b.id || ''), model: str(b.model), effort: str(b.effort), name: str(b.name) })); } catch (err) { return json(res, 400, { error: err.message }); }
    }
    if (req.method === 'POST' && p === '/api/todo') {
      const { id, answer, note, files, dismiss: drop } = await body(req);
      if (drop) { try { dismiss([Number(id)], '대표가 지움'); } catch (err) { return json(res, 400, { error: err.message }); } return json(res, 200, { ok: true }); }
      try { submitTodo(Number(id), String(answer ?? ''), String(note ?? ''), Array.isArray(files) ? files : []); } catch (err) { return json(res, 400, { error: err.message }); }
      return json(res, 200, { ok: true });
    }
    json(res, 404, { error: 'not found' });
  } catch (err) {
    json(res, 500, { error: err.message });
  }
}).on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `${port}번 포트는 이미 사용 중입니다. --port로 다른 번호를 주세요.` : e); process.exit(1); })
  .listen(port, '127.0.0.1', () => console.log(`AI 오피스: http://127.0.0.1:${port}${replay ? '  (리플레이 모드)' : ''}`));
