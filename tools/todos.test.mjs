// node tools/todos.test.mjs
import assert from 'node:assert/strict';
import { parseTodos, answerTodo, uploadPlan } from './todos.mjs';

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
console.log('todos ok');

const up = uploadPlan('T5', [{ name: '../../evil.png', data: 'aGk=' }, { name: 'a.png', data: '' }, { name: 'a.png' }, { name: '.env' }]);
assert.deepEqual(up.map((u) => u.rel), ['board/uploads/T5/evil.png', 'board/uploads/T5/a.png', 'board/uploads/T5/a-2.png', 'board/uploads/T5/_env']);
assert.equal(up[0].buf.toString(), 'hi');
console.log('upload ok');
