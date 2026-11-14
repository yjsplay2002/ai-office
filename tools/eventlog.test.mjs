// node tools/eventlog.test.mjs — the saved dashboard log: trim by age and size, drop re-attached runs, next run id.
import assert from 'node:assert/strict';
import { loadLog, lastRun, todoThread, linkAnswers, keepRuns, tail } from './eventlog.mjs';

const now = Date.parse('2026-11-12T00:00:00Z'), day = 864e5;
const L = (o) => JSON.stringify(o);
const text = [
  L({ _t: now - 8 * day, _run: 1, type: '_office', prompt: '오래된 지시' }),   // older than 7 days
  L({ _t: now - day, _run: 2, type: '_office', prompt: '어제 지시' }),
  'not json',
  L({ _t: now - day + 1, _run: 2, type: 'result', result: '끝' }),
  L({ _t: now - 10, _run: 3, type: 'assistant' }),                             // run 3 is re-attached on boot
  L({ _t: now - 5, type: '_office', log: '취소됨' }),
  '',
].join('\r\n');

const kept = loadLog(text, { now, drop: new Set([3]) });
assert.deepEqual(kept.map((l) => JSON.parse(l)._run ?? null), [2, 2, null]);
assert.equal(loadLog(text, { now }).length, 4);
assert.deepEqual(loadLog(text, { now, max: 2 }).map((l) => JSON.parse(l)._t), [now - day, now - 10, now - 5]);   // newest kept + 스레드를 연 지시
assert.equal(lastRun(loadLog(text, { now, days: 30 })), 3);
assert.equal(lastRun([]), 0);
assert.deepEqual(loadLog(''), []);
console.log('eventlog ok:', kept.length, 'kept');

// TODO 답 실행은 그 TODO를 올린 작업의 스레드에 붙는다(보고·근거 줄의 -run<N>.md = 올린 실행)
{
  const log = [
    L({ _run: 5, type: '_office', prompt: '빌드 올려' }),
    L({ _run: 6, type: '_office', prompt: '댓글', thread: 5 }),
    L({ _run: 7, type: '_office', prompt: '대표가 TODO에 답했습니다:\n- T20 [실행 · dev] 폰으로 확인 → 완료' }),
    L({ _run: 8, type: '_office', prompt: '대표가 TODO에 답했습니다:\n- T21 [승인 · dev] 올릴까요? → 승인' }),
    L({ _run: 9, type: '_office', prompt: '대표가 TODO에 답했습니다:\n- T99 [실행 · dev] 모름 → 완료' }),
  ];
  const todos = [{ id: 20, refs: ['board/dev/x.md', 'board/reports/2026-11-13-0900-run6.md'] }, { id: 21, refs: ['board/reports/a-run7.md'] }];
  assert.equal(todoThread(todos[0], log), 5);          // run 6 belongs to thread 5
  assert.equal(todoThread({ id: 1, refs: [] }, log), null);
  const out = linkAnswers(log, todos).map((l) => JSON.parse(l).thread);
  assert.deepEqual(out, [undefined, 5, 5, 5, undefined]);   // run 8's TODO came from run 7, which now sits in thread 5
}
// "(T20 후속)"은 T20을 따라가고, 옮겨진 실행에 달린 댓글 실행도 함께 옮긴다
{
  const log = [
    L({ _run: 5, type: '_office', prompt: '빌드 올려' }),
    L({ _run: 7, type: '_office', prompt: '대표가 TODO에 답했습니다:\n- T22 [실행 · dev] (T20 후속) 다시 확인 → 완료' }),
    L({ _run: 8, type: '_office', prompt: '댓글', thread: 7 }),
  ];
  const todos = [{ id: 20, refs: ['board/reports/a-run5.md'] }, { id: 22, desc: '(T20 후속) 다시 확인', refs: [] }];
  assert.deepEqual(linkAnswers(log, todos).map((l) => JSON.parse(l).thread), [undefined, 5, 5]);
}
// 실행 중에 올라온 TODO(보고 링크 없음)는 그 머리줄을 처음 쓴 실행의 스레드
{
  const log = [
    L({ _run: 5, type: '_office', prompt: '빌드 올려' }),
    L({ _run: 6, type: '_office', prompt: '댓글', thread: 5 }),
    L({ _run: 6, type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: "cat >> board/todos.md <<'EOF'\n### T30 · 승인 · dev\n배포" } }] } }),
    L({ _run: 9, type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'grep "^### T30" board/todos.md' } }] } }),
  ];
  assert.equal(todoThread({ id: 30, desc: '배포', refs: [] }, log), 5);
  assert.equal(todoThread({ id: 31, desc: 'x', refs: [] }, log), null);
}
// 보관은 스레드 단위: 열린 TODO가 걸린 스레드(실행 1과 거기 붙은 실행 4)는 7일·줄 수를 넘겨도 남는다
{
  const log = [
    L({ _t: now - 9 * day, _run: 1, type: '_office', prompt: '오래된 작업' }),
    L({ _t: now - 9 * day, _run: 1, type: 'result', result: '보고' }),
    L({ _t: now - 9 * day, _run: 4, type: '_office', prompt: '댓글', thread: 1 }),
    L({ _t: now - 9 * day, _run: 2, type: '_office', prompt: '다른 옛 작업' }),
    L({ _t: now - 10, _run: 3, type: '_office', prompt: '새 작업' }),
    L({ _t: now - 5, _run: 3, type: 'result', result: '끝' }),
  ];
  const todos = [{ id: 30, refs: ['board/reports/x-run4.md'] }, { id: 31, done: true, refs: ['board/reports/x-run2.md'] }];
  const keep = keepRuns(log, todos);
  assert.deepEqual([...keep].sort(), [1, 4]);
  assert.deepEqual(loadLog(log.join('\n'), { now, keep }).map((l) => JSON.parse(l)._run), [1, 1, 4, 3, 3]);
  assert.deepEqual(loadLog(log.join('\n'), { now, keep, max: 1 }).map((l) => JSON.parse(l)._run), [1, 1, 4, 3, 3]);   // 3의 지시 줄도 뼈대라 남는다
}
console.log('eventlog keep ok');

// 줄 수로 자를 때도 스레드 뼈대(지시·종료)는 남는다: 잘리면 그 스레드에 이어 붙은 일이 목록에서 사라진다
{
  const L = [
    JSON.stringify({ _t: 1, type: '_office', prompt: '홍보 계획', _run: 52 }),
    JSON.stringify({ _t: 2, type: 'assistant', _run: 52, text: 'x' }),
    JSON.stringify({ _t: 3, type: '_office', closed: 40 }),
    JSON.stringify({ _t: 4, type: '_office', log: '로그' }),
    JSON.stringify({ _t: 5, type: 'assistant', _run: 69 }),
  ];
  assert.deepEqual(tail(L, 1).map((l) => JSON.parse(l)._t), [1, 3, 5]);
  assert.deepEqual(tail(L, 1, new Set([52])).map((l) => JSON.parse(l)._t), [1, 2, 3, 5]);
}

// 새 주제라 뗀 답 실행(from)은 부팅 때 원래 스레드로 다시 붙이지 않는다
{
  const L = [
    JSON.stringify({ _t: 1, type: '_office', prompt: '옛 작업', _run: 1 }),
    JSON.stringify({ _t: 2, type: '_office', prompt: '대표가 TODO에 답했습니다:\n- T5 [승인 · m] x → 반려', _run: 2, from: 1 }),
  ];
  const out = linkAnswers(L, [{ id: 5, refs: ['board/reports/a-run1.md'], desc: 'x' }]);
  assert.equal(JSON.parse(out[1]).thread, undefined);
  assert.equal(JSON.parse(linkAnswers([L[0], L[1].replace(',"from":1', '')], [{ id: 5, refs: ['board/reports/a-run1.md'], desc: 'x' }])[1]).thread, 1);
}
