// node tools/history.test.mjs — subagent attribution and task cards, on lines shaped like real `claude -p` runs:
// child lines carry parent_tool_use_id = the Agent tool_use id; most task_* lines are a subagent's own Bash tasks;
// a background agent's tool_result only says "launched" and it ends with task_notification.
import assert from 'node:assert/strict';
import { createMapper, createHistory } from './map.mjs';

const A = (content, parent = null) => ({ type: 'assistant', message: { content }, parent_tool_use_id: parent });
const U = (content, parent = null) => ({ type: 'user', message: { content }, parent_tool_use_id: parent });
const tool = (id, name, input) => ({ type: 'tool_use', id, name, input });
const lines = [
  A([tool('ag1', 'Agent', { subagent_type: 'plan', description: '가격 선택지', prompt: '조사 결과로\n가격 선택지 3개' })]),
  { type: 'system', subtype: 'task_started', tool_use_id: 'ag1', subagent_type: 'plan', task_type: 'local_agent' },
  A([tool('r1', 'Read', { file_path: 'C:\\x\\board\\research\\a.md' })], 'ag1'),
  { type: 'system', subtype: 'task_started', tool_use_id: 'b1', owned_by_subagent: true, task_type: 'local_bash' },
  A([tool('b1', 'Bash', { command: 'npm test', description: '테스트 실행' })], 'ag1'),
  { type: 'system', subtype: 'task_notification', tool_use_id: 'b1', status: 'completed', summary: 'npm test' },
  A([{ type: 'text', text: '세 가지로 정리합니다.\n자세히는…' }], 'ag1'),
  A([tool('w1', 'Write', { file_path: '/p/board/plans/p.md' })], 'ag1'),
  { type: 'system', subtype: 'task_notification', tool_use_id: 'ag1', status: 'completed', summary: '완료' },
  U([{ type: 'tool_result', tool_use_id: 'ag1', content: [{ type: 'text', text: '선택지 3개' }] }]),
  // unknown agent type: error result, never ran
  A([tool('ag2', 'Agent', { subagent_type: 'sound', description: '효과음' })]),
  U([{ type: 'tool_result', tool_use_id: 'ag2', is_error: true, content: "Agent type 'sound' not found." }]),
  // background agent: launch ack first, work later, notification last
  A([tool('ag3', 'Agent', { subagent_type: 'general-purpose', description: '효과음', run_in_background: true })]),
  U([{ type: 'tool_result', tool_use_id: 'ag3', content: [{ type: 'text', text: 'Async agent launched successfully.' }] }]),
  A([tool('g1', 'WebSearch', { query: '무료 효과음' })], 'ag3'),
  A([tool('p1', 'Read', { file_path: '/p/board/todos.md' })]),
  { type: 'system', subtype: 'task_notification', tool_use_id: 'ag3', status: 'completed', summary: '효과음 12개 정리' },
  { type: 'result', result: '끝났습니다.', is_error: false },
];

const feed = createMapper(), h = createHistory();
h.run(1, '가격 정해 줘', 0);
const evs = [];
lines.forEach((l, t) => { for (const ev of feed(l)) { evs.push(ev); h.feed(ev, t + 1, 1); } });

const pick = (k) => evs.filter((e) => e.kind === k);
assert.deepEqual(pick('report').map((e) => [e.agent, e.ok]), [['plan', true], ['sound', false], ['general-purpose', true]]);   // once each, bg only at the end
assert.deepEqual(pick('tool').map((e) => [e.agent, e.tool]), [['plan', 'Read'], ['plan', 'Bash'], ['plan', 'Write'], ['general-purpose', 'WebSearch'], ['pm', 'Read']]);
assert.equal(pick('tool')[1].detail, '테스트 실행');
assert.equal(pick('say')[0].agent, 'plan');

const plan = h.latest('plan');
assert.equal(plan.title, '가격 선택지');
assert.equal(plan.state, '완료');
assert.deepEqual(plan.ev.map((e) => e[1]), ['order', 'read', 'run', 'say', 'write', 'report']);
assert.equal(plan.ev[0][2], '조사 결과로\n가격 선택지 3개');   // full text kept; the card clamps it
assert.equal(plan.ev[4][3], 'board/plans/p.md');
assert.equal(h.latest('sound').state, '실패');
assert.equal(h.latest('general-purpose').ev.at(-1)[2], '효과음 12개 정리');
const pm = h.latest('pm');
assert.equal(pm.state, '완료');
assert.ok(pm.ev.some((e) => e[1] === 'read' && e[3] === 'board/todos.md'));
assert.ok(pm.ev.some((e) => e[2].startsWith('plan에게 맡김')));

// A run that stops before its background agent reports closes the card.
const h2 = createHistory(), f2 = createMapper();
for (const ev of f2(lines[12])) h2.feed(ev, 1, 2);
h2.end(2);
assert.equal(h2.latest('general-purpose').state, '보고 없이 끝남');
// Overlapping runs: a newer run that already finished must not hide the one still going.
const h3 = createHistory();
h3.run(1, '긴 작업', 1); h3.run(2, '짧은 답', 2); h3.feed({ kind: 'result', text: '끝' }, 3, 2);
assert.equal(h3.latest('pm').title, '긴 작업');
h3.end(1);
assert.equal(h3.latest('pm').title, '짧은 답');
// Dedupe: the final result repeats the PM's last message(s); a memo/report equal to an earlier line is not added again.
const long = '긴 메모 '.repeat(60).trim();
const h4 = createHistory();
h4.run(1, '정리해 줘', 0);
h4.feed({ kind: 'say', agent: 'pm', text: long }, 1, 1);
h4.feed({ kind: 'say', agent: 'pm', text: long }, 2, 1);
h4.feed({ kind: 'say', agent: 'pm', text: '둘째 줄' }, 3, 1);
h4.feed({ kind: 'result', text: `${long}

둘째 줄` }, 4, 1);
h4.feed({ kind: 'result', text: '새 결론' }, 5, 1);
assert.deepEqual(h4.latest('pm').ev.map((e) => e[1]), ['order', 'say', 'say', 'report']);
assert.equal(h4.latest('pm').ev[1][2], long);   // not cut
assert.equal(h4.latest('pm').ev.at(-1)[2], '새 결론');
console.log('history ok:', pick('report').length, 'reports,', h.tasks.size, 'cards');
