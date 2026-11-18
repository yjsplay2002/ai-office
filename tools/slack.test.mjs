// node tools/slack.test.mjs — 슬랙 메시지가 무엇이 되는지, 그리고 가짜 Slack API로 스레드가 어떻게 올라가는지.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { channelName, routeSlack, todoCard, answerModal, slackConfig, createSlack, writeApps, botKey, withTodoTitles, todoBoard } from './slack.mjs';

assert.equal(channelName('biz-ops'), 'ai-office-biz-ops');
assert.equal(channelName('My App!!'), 'ai-office-my-app');
assert.equal(channelName('사업팀'), 'ai-office');
assert.equal(channelName('ai-office-x'), 'ai-office-x');
assert.ok(channelName('a'.repeat(200)).length <= 80);

const d = mkdtempSync(path.join(os.tmpdir(), 'slack-'));
assert.equal(slackConfig(d, {}), null);
assert.equal(slackConfig(d, { SLACK_BOT_TOKEN: 'x', SLACK_USER_ID: 'U' }), null);   // 셸의 다른 앱 토큰은 안 씀
writeFileSync(path.join(d, '.office-slack.env'), 'SLACK_BOT_TOKEN=xoxb-1\nSLACK_USER_ID=U1\n');
assert.deepEqual(slackConfig(d, {}), { token: 'xoxb-1', owner: 'U1', app: '', channel: '', name: channelName(path.basename(d)), url: '', bots: {} });
writeFileSync(path.join(d, '.office-slack.env'), 'SLACK_BOT_TOKEN=xoxb-1\nSLACK_USER_ID=U1\nSLACK_BOT_TOKEN_MARKETING=xoxb-m\nSLACK_BOT_TOKEN_=x\n');
assert.deepEqual(slackConfig(d, { OFFICE_SLACK_BOT_TOKEN_CS_BOT: 'xoxb-c', SLACK_BOT_TOKEN_DEV: 'shell' }).bots, { MARKETING: 'xoxb-m', CS_BOT: 'xoxb-c' });
assert.equal(botKey('cs-bot'), 'CS_BOT');

const todos = [{ id: 7, type: '승인', by: 'dev', desc: '배포할까요?', options: ['승인', '반려'], ref: '' }];
const ctx = { owner: 'U1', channel: 'C1', threadOf: (ts) => (ts === '100.1' ? 5 : null), todos };
const ev = (o) => ({ type: 'message', channel: 'C1', user: 'U1', ts: '200.1', ...o });
assert.deepEqual(routeSlack(ev({ text: '경쟁사 &lt;조사&gt;' }), ctx), { kind: 'run', prompt: '경쟁사 <조사>', ts: '200.1' });
assert.deepEqual(routeSlack(ev({ text: '색 바꿔', thread_ts: '100.1' }), ctx), { kind: 'comment', thread: 5, text: '색 바꿔', ts: '100.1' });
assert.equal(routeSlack(ev({ text: 'x', thread_ts: '999.1' }), ctx).kind, 'error');
assert.deepEqual(routeSlack(ev({ text: 'T7 반려 너무 어두움', thread_ts: '100.1' }), ctx), { kind: 'answer', id: 7, answer: '반려', note: '너무 어두움', ts: '100.1' });
assert.equal(routeSlack(ev({ text: 'T99 뭔가', thread_ts: '100.1' }), ctx).kind, 'comment');   // 열린 TODO가 아니면 그냥 댓글
// 팀원 봇 멘션: 그 팀원에게 직접(멘션은 글에서 빠짐). PM 봇 멘션은 빼고 PM에게, 모르는 사람 멘션은 그대로.
const mctx = { ...ctx, self: 'UPM', members: { UMK: 'marketing', UDV: 'dev' } };
assert.deepEqual(routeSlack(ev({ text: '<@UMK> 경쟁사 톤 정리해' }), mctx), { kind: 'run', prompt: '경쟁사 톤 정리해', ts: '200.1', member: 'marketing' });
assert.deepEqual(routeSlack(ev({ text: '<@UDV|dev> 이것도 고쳐 <@UMK>', thread_ts: '100.1' }), mctx), { kind: 'comment', thread: 5, text: '이것도 고쳐', ts: '100.1', member: 'dev' });
assert.deepEqual(routeSlack(ev({ text: '<@UPM> <@U9> 확인', thread_ts: '100.1' }), mctx), { kind: 'comment', thread: 5, text: '<@U9> 확인', ts: '100.1', member: '' });
assert.equal(routeSlack(ev({ text: '<@UMK>' }), mctx).kind, 'none');
assert.equal(routeSlack(ev({ text: '<@UMK> T7 승인', thread_ts: '100.1' }), mctx).kind, 'answer');
// 첨부 글(subtype file_share): 파일 주소가 실리고, 글 없이 파일만 와도 지시·댓글·입력 답이 된다
const fl = { subtype: 'file_share', files: [{ name: 'a.png', url_private_download: 'https://files.slack.com/a.png' }, { id: 'F2', mode: 'external' }] };
assert.deepEqual(routeSlack(ev({ text: '이거 봐', ...fl }), ctx), { kind: 'run', prompt: '이거 봐', ts: '200.1', files: [{ name: 'a.png', url: 'https://files.slack.com/a.png' }] });
assert.deepEqual(routeSlack(ev({ text: '', thread_ts: '100.1', ...fl }), ctx).files.length, 1);
assert.equal(routeSlack(ev({ text: '', thread_ts: '100.1', ...fl }), ctx).kind, 'comment');
assert.equal(routeSlack(ev({ text: '', thread_ts: '999.1', ...fl }), ctx).files, undefined);
// 대표가 아니거나, 다른 채널이거나, 봇·편집 글은 무시(신뢰 경계)
for (const o of [{ user: 'U2' }, { channel: 'C2' }, { bot_id: 'B1' }, { subtype: 'message_changed' }]) assert.equal(routeSlack(ev({ text: 'rm', ...o }), ctx).kind, 'none');

const card = todoCard(todos[0], 'U1');
assert.match(card.blocks[0].text.text, /^<@U1> \*T7 승인\* · dev\n/);
assert.equal(todoCard({ ...todos[0], type: '확인', desc: '보고를 확인해 주세요: 길게', ref: 'board/reports/r.md' }, '').blocks[0].text.text, '*T7 확인* · dev\n위 보고를 확인해 주세요.');
assert.deepEqual(card.blocks[1].elements.map((b) => JSON.parse(b.value)), [{ id: 7, answer: '승인' }, { id: 7, answer: '반려' }]);
assert.deepEqual(JSON.parse(todoCard({ ...todos[0], type: '입력', options: [] }, 'U1').blocks[1].elements[0].value), { id: 7, answer: '' });
assert.equal(answerModal({ ...todos[0], type: '입력' }, '', {}).blocks[1].optional, false);
assert.equal(answerModal(todos[0], '승인', {}).blocks[1].optional, true);

// 가짜 Slack API: 채널을 만들고, 스레드 머리글은 한 번만, 진행·보고·TODO 카드는 그 스레드 답글로.
const calls = [];
let canvasErr = '';
let n = 0;
globalThis.fetch = async (url, { body, headers }) => {
  if (!url.startsWith('https://slack.com/')) { calls.push({ method: 'upload', url, size: body.length }); return { ok: true, status: 200 }; }
  const method = url.split('/').pop(), tok = headers.authorization.slice(7);
  const b = headers['content-type'].includes('form') ? Object.fromEntries(new URLSearchParams(body)) : JSON.parse(body);
  calls.push({ method, tok, ...b });
  if (method === 'files.getUploadURLExternal' && tok === 'xoxb-m') return { status: 200, headers: new Map(), json: async () => ({ ok: false, error: 'missing_scope' }) };
  if (method === 'conversations.canvases.create' && canvasErr) return { status: 200, headers: new Map(), json: async () => ({ ok: false, error: canvasErr }) };
  const res = method === 'conversations.canvases.create' ? { canvas_id: 'FCV' } : method === 'files.getUploadURLExternal' ? { upload_url: 'https://files.slack.com/up/' + b.filename, file_id: 'F' + b.filename } : method === 'chat.postMessage' ? { ts: `${++n}.0` } : method === 'conversations.create' ? { channel: { id: 'C9' } } : method === 'auth.test' ? { user_id: { t: 'UPM', 'xoxb-m': 'UMK' }[tok] } : {};
  if (tok === 'xoxb-bad') return { status: 200, headers: new Map(), json: async () => ({ ok: false, error: 'invalid_auth' }) };
  return { status: 200, headers: new Map(), json: async () => ({ ok: true, ...res }) };
};
const logs = [];
const s = createSlack({ cfg: { token: 't', owner: 'U1', app: '', channel: '', name: 'ai-office-t' }, runDir: d, todos: () => todos,
  threadPrompt: () => '옛 지시', onRun() {}, onComment() {}, onAnswer() {}, log: (...a) => logs.push(a.join(' ')) });
s.runStarted({ id: 3, thread: 3, prompt: '홍보 계획 세워' });
s.progress(3, '▶️ 마케팅 시작');
s.report(3, { result: '## 끝\n- 초안 3개' }, todos);
s.progress(1, '옛 스레드');   // 슬랙을 켜기 전 스레드: 그 지시로 머리글을 만든다
s.runStarted({ id: 4, thread: 3, prompt: '이어서', shown: '더 짧게' });
await new Promise((ok) => setTimeout(ok, 50));
const posts = calls.filter((c) => c.method === 'chat.postMessage');
if (process.env.DBG) console.log(posts.map((p) => [p.thread_ts, p.text]));
assert.deepEqual(calls.slice(0, 3).map((c) => c.method), ['conversations.create', 'auth.test', 'conversations.invite']);
assert.equal(posts[0].thread_ts, undefined);
assert.match(posts[0].text, /홍보 계획 세워/);
assert.deepEqual(posts.slice(1, 4).map((p) => p.thread_ts), ['1.0', '1.0', '1.0']);
assert.match(posts[2].blocks[0].text, /<@U1> \*\*최종 보고\*\*\n\n## 끝/);
assert.doesNotMatch(posts[3].blocks[0].text.text, /<@U1>/);   // 보고에서 이미 불렀다
assert.equal(posts[3].blocks[1].type, 'actions');
assert.match(posts[4].text, /옛 지시/);
assert.equal(posts[5].thread_ts, '5.0');
assert.match(posts[6].blocks[0].text, /^대표 댓글: 더 짧게/);
assert.equal(posts[6].thread_ts, '1.0');
assert.deepEqual(s.openTodos(), [7]);
s.todoDone({ ...todos[0], answer: '승인' });
await new Promise((ok) => setTimeout(ok, 20));
assert.equal(calls.at(-1).method, 'chat.update');
assert.equal(calls.at(-1).ts, '4.0');
const st = JSON.parse(readFileSync(path.join(d, 'slack.json'), 'utf8'));
assert.deepEqual([st.channel, st.threads['3'], st.threads['1']], ['C9', '1.0', '5.0']);
assert.deepEqual(logs.filter((l) => l.includes('실패')), []);
// 뒤 보고가 대신한 '확인' 카드는 지운다
s.notifyTodo({ id: 9, type: '확인', by: 'pm', desc: '보고를 확인해 주세요: a', ref: 'board/reports/r.md', options: [] }, 1, true);
await new Promise((ok) => setTimeout(ok, 20));
s.todoDone({ id: 9, answer: '취소 (새 보고로 바뀜)' });
await new Promise((ok) => setTimeout(ok, 20));
assert.equal(calls.at(-1).method, 'chat.delete');
assert.deepEqual(s.openTodos(), []);

// 팀원 봇: PM이 진짜 멘션으로 맡기고, 결과·직접 보고·TODO 카드는 그 팀원 봇 토큰으로. 봇 없는 팀원은 예전처럼 PM 봇 글.
calls.length = 0;
const d2 = mkdtempSync(path.join(os.tmpdir(), 'slack-'));
const mt = [{ id: 8, type: '승인', by: 'marketing', desc: '게시할까요?', options: ['승인', '반려'], ref: '' }];
const logs2 = [];
const s2 = createSlack({ cfg: { token: 't', owner: 'U1', app: '', channel: 'C5', name: 'x', bots: { MARKETING: 'xoxb-m', DEV: 'xoxb-bad' } }, runDir: d2, root: d2, todos: () => mt,
  threadPrompt: () => '', onRun() {}, onComment() {}, onAnswer() {}, agents: () => ['marketing', 'research', 'dev'], log: (...a) => logs2.push(a.join(' ')) });
s2.runStarted({ id: 1, thread: 1, prompt: 'SNS 계획' });
s2.delegated(1, 'marketing', '마케팅', '톤 조사');
s2.returned(1, 'marketing', '마케팅', 3, '초안 3개');
s2.delegated(1, 'research', '조사', '시장');
s2.report(1, { result: '끝' }, mt, 'marketing');
await new Promise((ok) => setTimeout(ok, 50));
s2.todoDone({ ...mt[0], answer: '승인' });
await new Promise((ok) => setTimeout(ok, 20));
const p2 = calls.filter((c) => c.method === 'chat.postMessage');
if (process.env.DBG) console.log(p2.map((p) => [p.tok, p.text]), logs2);
assert.deepEqual(calls.filter((c) => c.method === 'conversations.invite').map((c) => c.users), ['U1', 'UMK']);
assert.deepEqual(p2.map((p) => p.tok), ['t', 't', 'xoxb-m', 't', 'xoxb-m', 't']);   // TODO 카드는 PM 봇(버튼이 PM 앱으로 오게)
assert.equal(p2[1].text, '<@UMK> 톤 조사');
assert.match(p2[2].blocks[0].text, /끝났어요 \(3분\)\n\n초안 3개/);
assert.equal(p2[3].text, '조사에게 맡김 · 시장');
assert.equal(calls.at(-1).method, 'chat.update');
assert.equal(calls.at(-1).tok, 't');
assert.ok(logs2.some((l) => l.includes('dev 봇 토큰이 안 맞아요')));
// 대시보드 스레드처럼: 팀원 작업 줄 하나(새 말이 나오면 먼저 내보냄), 말은 그 팀원 봇으로, 봇 없는 팀원은 PM 봇이 이름을 붙여
calls.length = 0;
s2.worked(1, 'k', 'marketing', '마케팅', '읽음', 'Read a.md');
s2.worked(1, 'k', 'marketing', '마케팅', '조사', 'WebSearch 톤');
s2.said(1, 'marketing', '마케팅', '초안 끝', 'k');
s2.said(1, 'research', '조사', '시장 큼', 'k2');
await new Promise((ok) => setTimeout(ok, 50));
const p3 = calls.filter((c) => c.method === 'chat.postMessage');
assert.deepEqual(p3.map((p) => [p.tok, p.text]), [['xoxb-m', '작업 2건 · 읽음 1 · 조사 1 · 마지막 WebSearch 톤'], ['xoxb-m', '마케팅: 초안 끝'], ['t', '조사: 시장 큼']]);
assert.equal(p3[2].blocks[0].text, '**조사** · 시장 큼');
assert.equal(p3[0].blocks[0].type, 'context');
// 글에 나온 board/ 사진·소리는 그 스레드에 파일로(같은 파일은 한 번만). 팀원 앱에 files:write가 없으면 PM 앱으로
mkdirSync(path.join(d2, 'board', 'design'), { recursive: true });
writeFileSync(path.join(d2, 'board', 'design', 'a.png'), 'png');
writeFileSync(path.join(d2, 'board', 'design', 'b.mp3'), 'mp3!');
writeFileSync(path.join(d2, 'board', 'design', 'c.md'), '# 시안\n');
writeFileSync(path.join(d2, 'board', 'todos.md'), '# TODO\n');
calls.length = 0;
s2.said(1, 'marketing', '마케팅', '시안은 `C:\\x\\board\\design\\` 폴더에: `a.png`, `b.mp3`, `없음.png`', 'k');
s2.said(1, 'marketing', '마케팅', '다시 board/design/a.png, 설명은 board/design/c.md, board/todos.md', 'k');
await new Promise((ok) => setTimeout(ok, 50));
const up = calls.filter((c) => c.method.startsWith('files.') || c.method === 'upload');
assert.deepEqual(up.map((c) => [c.method, c.tok ?? c.size]), [['files.getUploadURLExternal', 'xoxb-m'], ['files.getUploadURLExternal', 't'], ['upload', 3], ['files.getUploadURLExternal', 't'], ['upload', 4], ['files.completeUploadExternal', 't'], ['files.getUploadURLExternal', 'xoxb-m'], ['files.getUploadURLExternal', 't'], ['upload', 9], ['files.completeUploadExternal', 't']]);
assert.deepEqual([JSON.parse(up[5].files).map((f) => f.title), up[5].channel_id, up[5].thread_ts], [['board/design/a.png', 'board/design/b.mp3'], 'C5', p3[0].thread_ts]);

// 매니페스트: 팀원마다 하나, 토큰 없는 팀원 목록
mkdirSync(path.join(d2, '.claude', 'agents'), { recursive: true });
writeFileSync(path.join(d2, '.claude', 'agents', 'marketing.md'), '---\nname: marketing\ndescription: 마케팅 「홍보」. 글을 쓴다.\n---\n');
writeFileSync(path.join(d2, '.claude', 'agents', 'dev.md'), '---\nname: dev\ndescription: 개발. 만든다.\n---\n');
assert.deepEqual(writeApps(d2, { MARKETING: 'x' }).missing, ['dev']);
const man = JSON.parse(readFileSync(path.join(d2, '.claude', 'slack-apps', 'marketing.json'), 'utf8'));
assert.deepEqual([man.display_information.name, man.features.bot_user.display_name, man.oauth_config.scopes.bot], ['마케팅 「홍보」', '홍보', ['chat:write', 'files:write']]);
// 번호 뒤 TODO 제목: 번호마다 첫 번째만, 경로 속 번호·제목이 이미 있는 글은 그대로
const tl = [{ id: 3, type: '결정', by: 'plan', desc: '가격 정책을 골라 주세요', done: false, answer: '' }, { id: 4, type: '승인', by: 'dev', desc: '배포 승인', done: true, answer: '승인' }];
assert.equal(withTodoTitles('T3을 올렸고 T3, T9도 봐 주세요', tl), 'T3(가격 정책을 골라 주세요)을 올렸고 T3, T9도 봐 주세요');
assert.equal(withTodoTitles('board/uploads/T3/a.png', tl), 'board/uploads/T3/a.png');
assert.equal(withTodoTitles('- T3 [결정 · plan] 가격 정책을 골라 주세요 → 19.99', tl), '- T3 [결정 · plan] 가격 정책을 골라 주세요 → 19.99');
// TODO 판: 처음엔 채널 캔버스를 만들고, 바뀔 때만 고치고, 남의 캔버스·권한 없음이면 한 번 알리고 끈다
calls.length = 0;
s.board(tl); s.board(tl);
await new Promise((ok) => setTimeout(ok, 20));
s.board([{ ...tl[0], done: true, answer: '19.99' }]);
await new Promise((ok) => setTimeout(ok, 20));
const cv = calls.filter((c) => c.method.startsWith('canvases') || c.method.startsWith('conversations.canvases'));
assert.deepEqual(cv.map((c) => c.method), ['conversations.canvases.create', 'canvases.edit']);
assert.equal(cv[1].canvas_id, 'FCV');
assert.equal(cv[1].changes[0].operation, 'replace');
assert.ok(cv[1].changes[0].document_content.markdown.includes('- [x] **T3 결정**'));
assert.equal(JSON.parse(readFileSync(path.join(d, 'slack.json'), 'utf8')).canvas, 'FCV');
canvasErr = 'channel_canvas_already_exists'; calls.length = 0;
const s4 = createSlack({ cfg: { token: 't', owner: 'U1', app: '', channel: 'C7', name: 'x' }, runDir: mkdtempSync(path.join(os.tmpdir(), 'slack4-')), todos: () => [],
  threadPrompt: () => '', onRun() {}, onComment() {}, onAnswer() {}, log: (...a) => logs.push(a.join(' ')) });
s4.board(tl); await new Promise((ok) => setTimeout(ok, 20)); s4.board([]); await new Promise((ok) => setTimeout(ok, 20));
assert.deepEqual(calls.filter((c) => c.method.includes('canvas')).map((c) => c.method), ['conversations.canvases.create']);   // 덮어쓰지 않고 끔
assert.ok(logs.at(-1).includes('이미 다른 캔버스'));
canvasErr = '';
const bd = todoBoard(tl);
assert.ok(bd.includes('- [ ] **T3 결정** · plan — 가격 정책을 골라 주세요') && bd.includes('- [x] **T4 승인** · dev — 배포 승인 → 승인'), bd);
console.log('slack ok');
