// node tools/todos.test.mjs
import assert from 'node:assert/strict';
import { parseTodos, answerTodo, dismissTodo, uploadPlan, addCheckTodo, addRunReport, followUp, resolvedIds, byComment, staleChecks } from './todos.mjs';

const src = `# 대표 TODO\r\n\r\n### T1 · 결정 · plan\r\n가격을 골라 주세요\r\n- 옵션: $14.99 / $19.99\r\n- 근거: board/plans/p.md\r\n- 상태: 대기\r\n\r\n### T2 · 입력 · research\r\n서비스 아이디어를 알려 주세요\r\n\r\n### T3 · 승인 · legal\r\n약관 초안 승인\r\n### 잘못된 머리글\r\n`;
const t = parseTodos(src);
assert.equal(t.length, 3);
assert.deepEqual(t[0].options, ['$14.99', '$19.99']);
assert.equal(t[0].ref, 'board/plans/p.md');
assert.deepEqual(t[2].options, ['승인', '반려']);
assert.equal(t[1].desc, '서비스 아이디어를 알려 주세요');

assert.throws(() => answerTodo(src, 1, '$9', '', 'D'), /보기/);
assert.throws(() => answerTodo(src, 2, '  ', '', 'D'), /입력/);
assert.match(answerTodo(src, 2, '', '첨부: board/uploads/T2/a.png', 'D').text, /첨부: board\/uploads\/T2\/a\.png/);   // 첨부만 있는 입력 답
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
// 지우기: 보기 검사 없이 '취소'로 닫힘(승인 TODO도)
const dis = dismissTodo(r.text, 3, '스레드 종료', '2026-11-14');
assert.deepEqual([parseTodos(dis.text)[2].done, parseTodos(dis.text)[2].answer], [true, '취소 (스레드 종료)']);
assert.throws(() => dismissTodo(dis.text, 3, 'x', 'D'), /이미/);
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
// 같은 스레드의 열린 앞 '확인'은 새 확인이 이어받아 닫힌다. 다른 스레드의 확인, 다른 종류(결정)는 그대로
{
  const t0 = run0 + '\n### T4 · 확인 · pm\n보고를 확인해 주세요: a\n- 근거: board/reports/x-run7.md\n- 상태: 대기\n\n### T5 · 확인 · pm\n보고를 확인해 주세요: b\n- 근거: board/reports/x-run9.md\n- 상태: 대기\n';
  const sr = addRunReport(t0, { summary: 'c', ref: 'board/reports/x-run8.md', before: [1, 2, 3, 4, 5], today: 'D', same: (t) => t.refs[0].endsWith('run7.md') || t.id === 2 });
  assert.deepEqual([sr.ids, sr.closed], [[6], [4]]);
  assert.deepEqual(parseTodos(sr.text).filter((x) => !x.done).map((x) => x.id), [1, 2, 3, 5, 6]);
  assert.equal(parseTodos(sr.text).find((x) => x.id === 4).answer, '취소 (새 보고로 바뀜)');
}
// 뒤 실행이 새 TODO(결정)를 올려 보고가 거기 붙어도, 같은 스레드의 열린 앞 '확인'은 닫힌다
{
  const t0 = run0 + '\n### T4 · 확인 · pm\n보고를 확인해 주세요: a\n- 근거: board/reports/x-run7.md\n- 상태: 대기\n';
  const sr = addRunReport(t0, { summary: 'c', ref: 'board/reports/x-run8.md', before: [1, 4], today: 'D', same: (t) => t.id === 4 || t.id === 2 });
  assert.deepEqual([sr.ids, sr.check, sr.closed], [[2, 3], false, [4]]);
}
// 스레드 댓글로 처리된 TODO: 보고의 "처리된 TODO:" 줄. 실행 전부터 열린 것만 닫는다(다른 스레드 것도)
{
  assert.deepEqual(resolvedIds('끝\n**처리된 TODO**: T1, T3\n'), [1, 3]);
  assert.deepEqual(resolvedIds('T1 언급만'), []);
  const sr = addRunReport(run0, { summary: 'x', ref: 'board/reports/x-run8.md', before: [1, 2], today: 'D', resolved: [1, 2, 3, 9], same: (t) => t.id !== 2 });
  const all = parseTodos(sr.text);
  assert.deepEqual(sr.settled, [1, 2]);   // 2 = 다른 스레드여도 닫음, 3 = 이 실행이 올린 것, 9 = 없음
  assert.equal(all.find((x) => x.id === 1).answer, '스레드에서 처리됨');
  assert.deepEqual([sr.ids, sr.check], [[3], false]);
}
assert.equal(followUp(t[0], '$19.99'), '- T1 [결정 · plan] 가격을 골라 주세요 → $19.99');
console.log('todos ok');

const up = uploadPlan('T5', [{ name: '../../evil.png', data: 'aGk=' }, { name: 'a.png', data: '' }, { name: 'a.png' }, { name: '.env' }]);
assert.deepEqual(up.map((u) => u.rel), ['board/uploads/T5/evil.png', 'board/uploads/T5/a.png', 'board/uploads/T5/a-2.png', 'board/uploads/T5/_env']);
assert.equal(up[0].buf.toString(), 'hi');
console.log('upload ok');
// 같은 번호가 둘(처리된 확인 T5 + 열린 실행 T5): 답·지우기는 열린 쪽에
{
  const dup = `### T5 · 확인 · pm\n보고\n- 상태: 완료 D\n- 답: 종료\n\n### T5 · 실행 · dev\n폰으로 사 보기\n- 상태: 대기\n\n### T6 · 결정 · plan\nx\n- 옵션: A / B\n`;
  const a = parseTodos(answerTodo(dup, 5, '', '했음', 'E').text);
  assert.deepEqual(a.map((t) => [t.id, t.done, t.answer]), [[5, true, '종료'], [5, true, '완료 — 했음'], [6, false, '']]);
  assert.deepEqual(parseTodos(dismissTodo(dup, 5, 'x', 'E').text).map((t) => t.answer), ['종료', '취소 (x)', '']);
}
console.log('dup ok');

// 스레드 댓글은 '확인'만 닫고, 다른 대기 TODO는 열어 둔 채 PM에게 "처리된 TODO"로 닫으라고 넘긴다(biz-ops T631)
{
  const open = parseTodos('### T5 · 결정 · plan\n가격?\n- 옵션: A / B\n- 상태: 대기\n### T6 · 확인 · pm\n보고를 확인해 주세요: x\n- 근거: board/reports/2026-11-25-101500-run9.md\n- 상태: 대기\n');
  const r = byComment(open);
  assert.deepEqual(r.close, [6]);
  assert.match(r.note, /\[이 댓글로 닫은 확인 TODO\]\n- T6 /);
  assert.match(r.note, /\[대기 중 TODO\]\n- T5 \[결정 · plan\] 가격\? \(보기: A \/ B\)\n.*처리된 TODO: T12.*다시 올리지 마/);
  assert.deepEqual(byComment([]), { close: [], note: '' });
  // 24시간: 보고 파일 이름의 시각(로컬)으로 잰다. 닫힌 것·시각 없는 것·확인이 아닌 것은 빼고
  const now = new Date('2026-11-26T10:16:00').getTime();
  const all = [...open, ...parseTodos('### T7 · 확인 · pm\nx\n- 근거: board/reports/2026-11-25-102000-run10.md\n- 상태: 대기\n### T8 · 확인 · pm\nx\n- 근거: board/x.md\n- 상태: 대기\n')];
  assert.deepEqual(staleChecks(all, now), [6]);
  assert.deepEqual(staleChecks(all, now + 5 * 60e3), [6, 7]);
}
console.log('comment ok');
