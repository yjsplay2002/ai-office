// node tools/look.test.mjs — look.mjs가 claude에 넘길 인자·메시지(모델은 부르지 않는다)
import assert from 'node:assert/strict';
import { parseArgs, userMessage } from './look.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const d = mkdtempSync(path.join(os.tmpdir(), 'look-t-')), a = path.join(d, 'a.png'), b = path.join(d, 'b.JPG');
writeFileSync(a, 'x'); writeFileSync(b, 'y');
assert.deepEqual(parseArgs([a, b, '버튼이 보여?']), { files: [a, b], question: '버튼이 보여?' });
assert.match(parseArgs([a]).question, /이상한 곳/);   // 질문을 빼면 기본 질문
assert.throws(() => parseArgs(['질문만']), /사용법/);
assert.throws(() => parseArgs(['a.txt', 'q']), /그림 파일이 아님/);
assert.throws(() => parseArgs([path.join(d, 'none.png'), 'q']), /파일 없음/);
assert.throws(() => parseArgs([]), /사용법/);
const m = JSON.parse(userMessage([a, b], 'q'));
assert.deepEqual(m.message.content.map((c) => c.type), ['text', 'image', 'text', 'image', 'text']);
assert.deepEqual(m.message.content[3].source, { type: 'base64', media_type: 'image/jpeg', data: Buffer.from('y').toString('base64') });
assert.equal(JSON.parse(userMessage([a], 'q')).message.content.length, 2);   // 한 장이면 번호 글 없이
console.log('look ok');
