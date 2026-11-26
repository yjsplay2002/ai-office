import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { threadStore } from './threads.mjs';
import { threadUsage } from './usage.mjs';

const dir = mkdtempSync(path.join(os.tmpdir(), 'office-threads-'));
try {
  const file = path.join(dir, 'threads.json');
  let store = threadStore(file);
  store.enqueue(1, 'dev', 'first', false);
  store.enqueue(1, 'dev', 'second', true);
  store.enqueue(1, 'design', 'third', true);
  store.enqueue(1, 'dev', 'fourth', true);
  store.enqueue(99, undefined, 'independent', false);
  store = threadStore(file);
  const first = store.batch(1);
  assert.deepEqual(first.map((e) => e.text), ['first', 'second']);
  const start = { type: '_office', prompt: 'feature', thread: 1, _run: 2, _t: 100, comments: first.map((e) => e.id) };
  store.record(start);
  store.record(start); // detached child reattaches
  assert.deepEqual(store.batch(1).map((e) => e.text), ['third']);
  store.enqueue(1, undefined, 'redirect', false, true);
  assert.deepEqual(store.batch(1).map((e) => e.text), ['redirect']);
  store.discard(1);
  assert.equal(store.pending(99).length, 1);
  store.record({ type: 'system', subtype: 'init', _run: 2, session_id: 'session-a' });
  store.record({ type: 'user', _run: 2, tool_use_result: { agentType: 'dev', agentId: 'worker-a', canContinueAgent: true } });
  assert.equal(threadStore(file).lastDev('session-a'), 'worker-a');
  assert.equal(store.lastDev('session-b'), undefined);
  store.record({ type: 'user', _run: 2, tool_use_result: { agentType: 'dev', agentId: 'worker-b', canContinueAgent: false } });
  assert.equal(store.lastDev('session-a'), null);
  const result = { _run: 2, type: 'result', num_turns: 2, subagent_stats: { by_type: { dev: 1 } },
    modelUsage: { pm: { inputTokens: 9999 } },
    model_usage_since_last_result: { pm: { inputTokens: 1, cacheCreationInputTokens: 10 }, dev: { cacheReadInputTokens: 30, outputTokens: 7 } } };
  store.record(result);
  store.record({ type: '_office', _run: 2, ended: true, _t: 120 });
  store.record({ ...start, _run: 3, _t: 150 });
  store.record({ type: 'system', subtype: 'init', _run: 3, session_id: 'session-a' });
  store.record({ ...result, _run: 3, subagent_stats: { by_type: {} } });
  store.record({ ...result, _run: 3, subagent_stats: { by_type: {} } });
  store.record({ type: '_office', _run: 3, ended: true, _t: 220 });
  assert.deepEqual(threadUsage(dir, Object.values(store.state.runs)), {
    in: 2, write: 20, cache: 60, out: 14, dev: 1, elapsed: 120, ended: true, partial: false,
  });
  assert.equal(threadUsage(dir, [{ start: 8 }], 22).partial, true);
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log('thread queue, worker reuse and usage ok');

