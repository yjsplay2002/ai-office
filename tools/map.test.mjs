// node tools/map.test.mjs — replays the synthetic demo run through the mapper.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMapper, boardRel } from './map.mjs';

const feed = createMapper();
const kinds = readFileSync(new URL('./fixtures/demo-run.jsonl', import.meta.url), 'utf8')
  .split('\n').filter(Boolean).flatMap((l) => feed(JSON.parse(l)));

const pick = (k) => kinds.filter((e) => e.kind === k);
assert.deepEqual(pick('dispatch').map((e) => e.agent), ['research', 'plan']);
assert.deepEqual(pick('paper'), [{ kind: 'paper', agent: 'research', path: 'board/research/competitors.md' }, { kind: 'paper', agent: 'plan', path: 'board/plans/hello.md' }]);
assert.deepEqual(pick('report').map((e) => e.agent), ['research', 'plan']);
assert.equal(pick('result').length, 1);
assert.ok(pick('limit')[0].five >= 0);
assert.ok(pick('tool').some((e) => e.agent === 'pm' && e.tool === 'Read'));
assert.equal(boardRel('C:\\x\\my-office\\board\\legal\\a.md'), 'board/legal/a.md');
assert.equal(boardRel('src/main.js'), null);
console.log('map ok:', kinds.map((e) => e.kind).join(' '));
