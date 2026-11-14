import assert from 'node:assert/strict';
import { judgePrompt, parseVerdict } from './topic.mjs';

assert.deepEqual(parseVerdict('{"new":[2],"title":"X 홍보 계획"}', 2), { fresh: [1], title: 'X 홍보 계획' });
assert.deepEqual(parseVerdict('```json\n{"new":[], "title":""}\n```', 1), { fresh: [], title: '' });
assert.deepEqual(parseVerdict('{"new":[0,3,1,1,"2"]}', 2), { fresh: [0, 1], title: '' });   // 범위 밖·중복 버림
assert.equal(parseVerdict('모르겠음', 1), null);
assert.equal(parseVerdict('{"new":"1"}', 1), null);
assert.equal(parseVerdict('{bad json}', 1), null);
assert.match(judgePrompt('출시 체크', ['- T1 [승인 · console] 제출? → 승인']), /1\. T1 \[승인/);
console.log('topic ok');
