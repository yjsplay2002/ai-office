// node tools/usage.test.mjs
import assert from 'node:assert/strict';
import { parseTranscript, usage } from './usage.mjs';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';

const u = (o) => JSON.stringify({ type: 'assistant', timestamp: '2026-11-05T03:00:00Z', message: { id: 'm1', usage: { input_tokens: 2, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: o } } });
const days = parseTranscript([u(5), u(40), '{"type":"user"}', 'broken'].join('\n'));
assert.deepEqual(Object.values(days), [{ in: 12, cache: 100, out: 40 }]); // repeated id counted once, last copy wins

// Synthetic transcripts under a temp home: main session = pm, subagents/<x>.meta.json names the agent.
const home = mkdtempSync(path.join(os.tmpdir(), 'usage-'));
process.env.HOME = process.env.USERPROFILE = home;
const root = path.join(home, 'proj');
const dir = path.join(home, '.claude', 'projects', root.replace(/[^A-Za-z0-9]/g, '-'));
mkdirSync(path.join(dir, 's1', 'subagents'), { recursive: true });
writeFileSync(path.join(dir, 's1.jsonl'), u(7));
writeFileSync(path.join(dir, 's1', 'subagents', 'agent-a.jsonl'), u(3));
writeFileSync(path.join(dir, 's1', 'subagents', 'agent-a.meta.json'), '{"agentType":"research"}');
const rows = usage(root);
rmSync(home, { recursive: true, force: true });
assert.deepEqual(rows.map((r) => [r.agent, r.total.out]), [['pm', 7], ['research', 3]]);
console.log('usage ok:', rows.map((r) => `${r.agent} ${r.total.in + r.total.cache + r.total.out}`).join(', '));
