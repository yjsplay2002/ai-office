// node tools/motion.test.mjs — what the 3D office acts out for each event, and walking around furniture.
import assert from 'node:assert/strict';
import { createMapper, motionOf, instructionMotion, todoMotion, gridPath } from './map.mjs';

// Events from a run -> motions, in order.
const feed = createMapper();
const A = (content, parent = null) => ({ type: 'assistant', message: { content }, parent_tool_use_id: parent });
const lines = [
  A([{ type: 'tool_use', id: 'ag1', name: 'Agent', input: { subagent_type: 'research', description: '조사' } }]),
  A([{ type: 'tool_use', id: 's1', name: 'WebSearch', input: { query: '경쟁사' } }], 'ag1'),
  A([{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/p/board/a.md' } }], 'ag1'),
  A([{ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: '/p/board/research/c.md' } }], 'ag1'),
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'ag1', content: '끝' }] }, parent_tool_use_id: null },
  { type: 'result', result: '보고합니다', is_error: false },
];
const m = lines.flatMap((l) => feed(l)).map(motionOf).filter(Boolean);
assert.deepEqual(m, [
  { walk: { who: 'pm', to: 'research', give: 'order' } },
  { work: { who: 'research', act: 'search' } },
  { work: { who: 'research', act: 'read' } },
  { work: { who: 'research', act: 'write' } },
  { file: { who: 'research', path: 'board/research/c.md' } },
  { walk: { who: 'research', to: 'pm', give: 'report' } },
  { walk: { who: 'pm', to: 'ceo', give: 'final' } },
]);
assert.equal(motionOf({ kind: 'limit' }), null);
assert.deepEqual(instructionMotion(), { walk: { who: 'pm', to: 'ceo', take: 'instruction' } });
assert.equal(todoMotion({ by: 'plan' }, ['pm', 'plan']).walk.who, 'plan');
assert.equal(todoMotion({ by: '외부 법무' }, ['pm', 'plan']).walk.who, 'pm');   // unknown asker: PM carries it

// Walking: a wall (column 5, rows 0..8) between start and goal; the path goes round its open end.
const n = 10, wall = (i, j) => i === 5 && j <= 8;
const p = gridPath(n, (i, j) => !wall(i, j), [1, 1], [8, 1]);
assert.ok(p && p[0].join() === '1,1' && p.at(-1).join() === '8,1');
assert.ok(p.every(([i, j]) => !wall(i, j)));
for (let k = 1; k < p.length; k++) {
  const [a, b] = p[k - 1], [c, d] = p[k];
  assert.ok(Math.abs(a - c) <= 1 && Math.abs(b - d) <= 1);
  if (a !== c && b !== d) assert.ok(!wall(a, d) && !wall(c, b), 'cut a corner');
}
assert.ok(p.some(([, j]) => j === 9));
assert.equal(gridPath(n, (i) => i !== 5, [1, 1], [8, 1]), null);   // fully walled off
console.log('motion ok:', m.length, 'motions, path', p.length, 'cells');
