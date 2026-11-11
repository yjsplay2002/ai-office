// node tools/eventlog.test.mjs — the saved dashboard log: trim by age and size, drop re-attached runs, next run id.
import assert from 'node:assert/strict';
import { loadLog, lastRun } from './eventlog.mjs';

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
assert.deepEqual(loadLog(text, { now, max: 2 }).map((l) => JSON.parse(l)._t), [now - 10, now - 5]);   // newest kept
assert.equal(lastRun(loadLog(text, { now, days: 30 })), 3);
assert.equal(lastRun([]), 0);
assert.deepEqual(loadLog(''), []);
console.log('eventlog ok:', kept.length, 'kept');
