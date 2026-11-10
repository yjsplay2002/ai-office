// node tools/telegram.test.mjs — what a Telegram message turns into.
import assert from 'node:assert/strict';
import { parseCommand, routeMessage } from './telegram.mjs';
import { answerTodo } from './todos.mjs';

const todos = [
  { id: 3, type: '결정', by: 'legal', options: ['개인사업자', '법인'] },
  { id: 4, type: '입력', by: 'research', options: [] },
  { id: 7, type: '실행', by: 'legal', options: [] },
  { id: 9, type: '승인', by: 'dev', options: ['승인', '반려'] },
];
const p = (text, replyTodo = null) => parseCommand(text, { replyTodo, todos });

assert.deepEqual(p('/todo'), { kind: 'todos' });
assert.deepEqual(p('/cancel@office_bot'), { kind: 'cancel' });
assert.deepEqual(p('/뭐'), { kind: 'help' });
assert.deepEqual(p('research에게 시장조사 시켜'), { kind: 'run', prompt: 'research에게 시장조사 시켜' });
assert.deepEqual(p('T99 이건 없는 번호'), { kind: 'run', prompt: 'T99 이건 없는 번호' });
assert.deepEqual(p('법인', 3), { kind: 'answer', id: 3, answer: '법인', note: '' });
assert.deepEqual(p('2 세무사랑 상의함', 3), { kind: 'answer', id: 3, answer: '법인', note: '세무사랑 상의함' });
assert.deepEqual(p('T3: 개인사업자 이미 등록'), { kind: 'answer', id: 3, answer: '개인사업자', note: '이미 등록' });
assert.equal(p('글쎄', 3).kind, 'error');
assert.deepEqual(p('t4 로그라이트', null), { kind: 'answer', id: 4, answer: '로그라이트', note: '' });
assert.equal(p('', 4).kind, 'error');
assert.deepEqual(p('홈택스 신청 완료', 7), { kind: 'answer', id: 7, answer: '', note: '홈택스 신청 완료' });
assert.equal(p('답', 12).kind, 'error');   // replied to a TODO that is already done
assert.deepEqual(p('반려: 색이 너무 어두움', 9), { kind: 'answer', id: 9, answer: '반려', note: '색이 너무 어두움' });
assert.equal(p('반려해', 9).kind, 'error');   // option must be followed by a separator
assert.equal(parseCommand('', { replyTodo: 4, todos, files: 1 }).answer, '첨부 참고');

// routing: a pressed button (choice) takes the next message as its reason
const r = (text, o = {}) => routeMessage(text, { todos, ...o });
const choice = { id: 9, answer: '반려' };
const c = r('색이 너무 어두움', { choice });
assert.deepEqual(c, { kind: 'answer', id: 9, answer: '반려', note: '색이 너무 어두움' });
const md = `### T9 · 승인 · dev
소환 연출 v2
- 상태: 대기
`;
assert.equal(answerTodo(md, 9, c.answer, c.note, 'D').full, '반려 — 색이 너무 어두움');
assert.equal(r('이유', { choice, replyTodo: 9 }).note, '이유');                       // reply to the prompt
assert.equal(r('T9 이유', { choice }).note, '이유');
assert.deepEqual(r('', { choice, files: 2 }), { kind: 'answer', id: 9, answer: '반려', note: '' });   // file only
assert.deepEqual(r('로그라이트', { choice, replyTodo: 4 }), { kind: 'answer', id: 4, answer: '로그라이트', note: '' });   // other TODO wins
assert.equal(r('T3 법인', { choice }).id, 3);
assert.equal(r('', { choice }).kind, 'none');   // sticker does not settle the choice
assert.deepEqual(r('', { choice: { id: 7, answer: '' }, files: 1 }), { kind: 'answer', id: 7, answer: '', note: '' });
// no choice
assert.equal(r('research에게 시켜').kind, 'run');
assert.equal(r('', { files: 1 }).kind, 'wait');
assert.deepEqual(r('', { files: 1, replyTodo: 4 }), { kind: 'answer', id: 4, answer: '첨부 참고', note: '' });
assert.equal(r('', { files: 1, replyTodo: 3 }).kind, 'error');   // 결정 needs a pick
console.log('telegram ok');
