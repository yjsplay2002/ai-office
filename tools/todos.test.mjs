// node tools/todos.test.mjs
import assert from 'node:assert/strict';
import { parseTodos, answerTodo, uploadPlan, addCheckTodo, addRunReport, followUp } from './todos.mjs';

const src = `# 대표 TODO\r\n\r\n### T1 · 결정 · plan\r\n가격을 골라 주세요\r\n- 옵션: $14.99 / $19.99\r\n- 근거: board/plans/p.md\r\n- 상태: 대기\r\n\r\n### T2 · 입력 · research\r\n서비스 아이디어를 알려 주세요\r\n\r\n### T3 · 승인 · legal\r\n약관 초안 승인\r\n### 잘못된 머리글\r\n`;
const t = parseTodos(src);
assert.equal(t.length, 3);
assert.deepEqual(t[0].options, ['$14.99', '$19.99']);
assert.equal(t[0].ref, 'board/plans/p.md');
assert.deepEqual(t[2].options, ['승인', '반려']);
assert.equal(t[1].desc, '서비스 아이디어를 알려 주세요');

assert.throws(() => answerTodo(src, 1, '$9', '', 'D'), /보기/);
assert.throws(() => answerTodo(src, 2, '  ', '', 'D'), /입력/);
assert.throws(() => answerTodo(src, 9, 'x', '', 'D'), /찾을 수 없음/);

let r = answerTodo(src, 1, '$19.99', '번들 할인 고려', '2026-11-04');
let after = parseTodos(r.text);
assert.ok(after[0].done && after[0].answer === '$19.99 — 번들 할인 고려');
assert.equal(after[1].done, false);
assert.throws(() => answerTodo(r.text, 1, '$14.99', '', 'D'), /이미/);

r = answerTodo(r.text, 2, '로그라이트\n스팀 PC', '', '2026-11-04');
after = parseTodos(r.text);
assert.equal(after[1].answer, '로그라이트');
assert.ok(r.text.includes('  스팀 PC'));
assert.equal(after[1].desc, '서비스 아이디어를 알려 주세요');
assert.equal(after.length, 3);
// 근거·파일·QR 이미지: 이름만 쓴 파일은 앞 경로 폴더로, 절대 경로는 board/부터, board/ 밖은 버림
const refs = parseTodos(`### T9 · 결정 · design
고르세요
- 파일: C:/Users/a b/repo/board/dev/shots/icon-512.png
- 근거: board/design/icon/A6-concept.md, compare-A6.png "절" (비교 board/design/x/compare.png)
- QR: game/x.png, ../x.png, C:/other/y.png, z.png, board/../secret.png, board/dev/fakeXpng, board/dev/run.mp4
`)[0].refs;
assert.deepEqual(refs, ['board/dev/shots/icon-512.png', 'board/design/icon/A6-concept.md', 'board/design/icon/compare-A6.png', 'board/design/x/compare.png', 'board/dev/run.mp4']);
// 확인 TODO: 끝난 실행의 보고. 번호는 파일의 가장 큰 T번호 + 1(완료·형식 틀린 것 포함), 종료 / 추가 지시
const base = '# 대표 TODO\r\n\r\n### T41 · 결정 · plan\r\n고르세요\r\n- 상태: 완료 2026-11-11\r\n\r\n### T7 · 이상한 유형 · x\r\n';
const c = addCheckTodo(base, { summary: '## 결과\n조사와 가격 선택지를 board/에 남겼습니다.\n자세히는…', ref: 'board/reports/2026-11-12-081000-run3.md' });
assert.equal(c.id, 42);
assert.ok(c.text.startsWith(base.trimEnd()) && c.text.includes('\r\n### T42 · 확인 · pm\r\n'));
const ck = parseTodos(c.text).find((x) => x.id === 42);
assert.equal(ck.type, '확인');
assert.equal(ck.desc, '보고를 확인해 주세요: 조사와 가격 선택지를 board/에 남겼습니다.');
assert.deepEqual(ck.options, ['종료', '추가 지시']);
assert.deepEqual(ck.refs, ['board/reports/2026-11-12-081000-run3.md']);
assert.equal(ck.status, '대기');
assert.equal(addCheckTodo('', { summary: 'x', ref: 'board/r.md', error: true }).id, 1);
assert.ok(addCheckTodo('', { summary: 'x', ref: 'board/r.md', error: true }).text.includes('작업이 오류로 끝났습니다'));
assert.throws(() => answerTodo(c.text, 42, '추가 지시', '  ', 'D'), /추가로 시킬 일/);
const closed = answerTodo(c.text, 42, '종료', '', '2026-11-12');
assert.equal(parseTodos(closed.text).find((x) => x.id === 42).answer, '종료');
assert.equal(followUp(closed.todo, closed.full), null);   // 종료: 새 PM 실행 없음
const more = answerTodo(c.text, 42, '추가 지시', '추천안으로 세부 계획까지', '2026-11-12');
assert.ok(more.text.includes('- 답: 추가 지시: 추천안으로 세부 계획까지'));
assert.equal(followUp(more.todo, more.full), '- T42 [확인 · pm] 보고를 확인해 주세요: 조사와 가격 선택지를 board/에 남겼습니다. → 추가 지시: 추천안으로 세부 계획까지 (보고 전문: board/reports/2026-11-12-081000-run3.md)');
// 하나의 일은 한 번만 보고: 실행 중 새로 올라온 결정 TODO가 있으면 거기에 보고를 붙이고 '확인'은 만들지 않는다
const run0 = '# 대표 TODO\n\n### T1 · 결정 · plan\n옛 결정\n- 상태: 대기\n\n### T2 · 결정 · plan\n가격을 골라 주세요\n- 옵션: A / B\n- 근거: board/plan/p.md\n- 상태: 대기\n\n### T3 · 입력 · dev\n계정 이메일\n- 상태: 대기\n';
const rr = addRunReport(run0, { summary: '가격 결정은 TODO로 올렸습니다.', ref: 'board/reports/r1.md', before: [1] });
assert.deepEqual([rr.ids, rr.check], [[2, 3], false]);
const rt = parseTodos(rr.text);
assert.equal(rt.length, 3);   // 확인 TODO 없음
assert.deepEqual(rt.find((x) => x.id === 2).refs, ['board/plan/p.md', 'board/reports/r1.md']);
assert.deepEqual(rt.find((x) => x.id === 3).refs, ['board/reports/r1.md']);
assert.deepEqual(rt.find((x) => x.id === 1).refs, []);   // 실행 전부터 있던 TODO는 그대로
assert.ok(rr.text.includes('- 보고: board/reports/r1.md\n- 상태: 대기'));
// 새 TODO가 없거나 오류로 끝나면 지금처럼 확인 TODO 하나
assert.equal(addRunReport(run0, { summary: 'x', ref: 'board/r.md', before: [1, 2, 3] }).check, true);
assert.equal(addRunReport(run0, { summary: 'x', ref: 'board/r.md', error: true, before: [1] }).check, true);
assert.equal(followUp(t[0], '$19.99'), '- T1 [결정 · plan] 가격을 골라 주세요 → $19.99');
console.log('todos ok');

const up = uploadPlan('T5', [{ name: '../../evil.png', data: 'aGk=' }, { name: 'a.png', data: '' }, { name: 'a.png' }, { name: '.env' }]);
assert.deepEqual(up.map((u) => u.rel), ['board/uploads/T5/evil.png', 'board/uploads/T5/a.png', 'board/uploads/T5/a-2.png', 'board/uploads/T5/_env']);
assert.equal(up[0].buf.toString(), 'hi');
console.log('upload ok');
