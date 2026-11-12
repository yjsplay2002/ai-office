// node tools/usage.test.mjs
import assert from 'node:assert/strict';
import { parseTranscript, usage } from './usage.mjs';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';

const u = (o) => JSON.stringify({ type: 'assistant', timestamp: '2026-11-05T03:00:00Z', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 2, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: o } } });
const { days, last } = parseTranscript([u(5), u(40), '{"type":"user"}', 'broken'].join('\n'));
assert.deepEqual(Object.values(days), [{ in: 12, cache: 100, out: 40 }]); // repeated id counted once, last copy wins
assert.equal(last.model, 'claude-opus-5-5');

// Synthetic transcripts under a temp home: main session = pm, subagents/<x>.meta.json names the agent.
const home = mkdtempSync(path.join(os.tmpdir(), 'usage-'));
process.env.HOME = process.env.USERPROFILE = home;
const root = path.join(home, 'proj');
const dir = path.join(home, '.claude', 'projects', root.replace(/[^A-Za-z0-9]/g, '-'));
mkdirSync(path.join(dir, 's1', 'subagents'), { recursive: true });
writeFileSync(path.join(dir, 's1.jsonl'), u(7));
writeFileSync(path.join(dir, 's1', 'subagents', 'agent-a.jsonl'), u(3));
writeFileSync(path.join(dir, 's1', 'subagents', 'agent-a.meta.json'), '{"agentType":"research"}');
// s2 = 같은 폴더에서 돈 오피스 밖 세션(대표의 일반 Claude 작업). sessions.txt에 없으니 세지 않는다.
mkdirSync(path.join(dir, 's2', 'subagents'), { recursive: true });
writeFileSync(path.join(dir, 's2.jsonl'), u(1000));
writeFileSync(path.join(dir, 's2', 'subagents', 'agent-b.jsonl'), u(1000));
mkdirSync(path.join(root, '.office-runs'), { recursive: true });
writeFileSync(path.join(root, '.office-runs', 'sessions.txt'), 's1\n');
const rows = usage(root);
rmSync(home, { recursive: true, force: true });
assert.deepEqual(rows.map((r) => [r.agent, r.total.out, r.model]), [['pm', 7, 'claude-opus-5-5'], ['research', 3, 'claude-opus-5-5']]);
console.log('usage ok:', rows.map((r) => `${r.agent} ${r.total.in + r.total.cache + r.total.out}`).join(', '));
