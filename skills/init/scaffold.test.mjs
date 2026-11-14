// node skills/init/scaffold.test.mjs — 빈 폴더에 두 번 만들고(두 번째는 아무것도 안 바꿈), 기존 파일은 건너뛰고 settings는 병합하는지 본다.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scaffold, normalize, pmFile } from './scaffold.mjs';

const answers = {
  business: '작은 온라인 서비스 $& $$', areas: ['조사', '개발'],
  roles: [
    { name: 'research', level: 'full' },
    { name: 'dev', level: 'partial', model: 'opus', effort: 'high' },
    { name: 'cs', level: 'partial', description: '고객 응대 「창구」. 문의에 답한다.', model: 'haiku', effort: 'low' },
    { name: 'legal', level: 'human', description: '법무 검토. 계약서를 본다.' },
  ],
  telegram: false, dashboard: true,
};
const dir = mkdtempSync(path.join(os.tmpdir(), 'office-'));
writeFileSync(path.join(dir, 'CLAUDE.md'), '# 내 규칙\n');
mkdirSync(path.join(dir, '.claude'));
writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ model: 'sonnet', permissions: { allow: ['Bash(npm test)'] } }));

const first = scaffold(answers, dir);
assert.ok(first.includes('건너뜀(이미 있음) CLAUDE.md'));
assert.equal(readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), '# 내 규칙\n');
const s = JSON.parse(readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
assert.equal(s.model, 'sonnet');
assert.ok(s.permissions.allow.includes('Bash(npm test)') && s.permissions.allow.includes('Agent'));
assert.deepEqual(s.permissions.deny, ['Bash(git push:*)']);

const agents = readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
assert.match(agents, /\| `research` \| 조사 「리서치」 \| AI 전적 위임 \| sonnet \/ medium \|/);
assert.match(agents, /\| `대표` \| 법무 검토 \| 사람만 \| — \|/);
assert.ok(!agents.includes('{{') && agents.includes('작은 온라인 서비스 $& $$'));
assert.ok(!existsSync(path.join(dir, '.claude', 'agents', 'legal.md')));
const cs = readFileSync(path.join(dir, '.claude', 'agents', 'cs.md'), 'utf8');
assert.match(cs, /^---\nname: cs\n/);
assert.match(cs, /model: haiku\neffort: low/);
assert.match(cs, /위임 수준: 일부 위임/);
assert.match(readFileSync(path.join(dir, '.claude', 'agents', 'research.md'), 'utf8'), /위임 수준: AI 전적 위임/);
for (const f of ['board/todos.md', 'board/research/.gitkeep', 'board/cs/.gitkeep', 'board/dev/backlog.md', 'tools/office.mjs', 'tools/fixtures/demo-run.jsonl']) assert.ok(existsSync(path.join(dir, f)), f);
assert.match(readFileSync(path.join(dir, '.gitignore'), 'utf8'), /\.office-runs\/\n\.office-telegram\.env\n\.office-slack\.env/);
assert.ok(!readFileSync(path.join(dir, 'AGENTS.md'), 'utf8').includes('슬랙'));
assert.match(pmFile(normalize({ ...answers, slack: true })), /오피스 슬랙 채널/);
assert.equal(normalize({ ...answers, slack: true, dashboard: false }).dashboard, true);

const second = scaffold(answers, dir);
assert.ok(second.every((l) => l.startsWith('건너뜀') || l.startsWith('그대로')), second.join('\n'));
assert.ok(scaffold(answers, dir, ['CLAUDE.md']).includes('덮어씀 CLAUDE.md'));

assert.throws(() => normalize({ roles: [{ name: '../x', level: 'full' }] }), /영문/);
assert.throws(() => normalize({ roles: [{ name: 'x', level: 'full' }] }), /description/);
assert.throws(() => normalize({ roles: [{ name: 'x', level: 'full', description: '응대. 키: 값' }] }), /description/);
assert.throws(() => normalize({ roles: [{ name: 'dev', level: 'full', model: 'claude-opus-4' }] }), /model/);
rmSync(dir, { recursive: true, force: true });
console.log('scaffold ok');
