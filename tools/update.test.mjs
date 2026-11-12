import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pluginTools, syncDir, updateTools, newer } from './update.mjs';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'office-update-'));
const mk = (f, s = '') => { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, s); };

// 설치 기록이 없으면 null, 있으면 가장 최근에 업데이트된 ai-office의 tools/
assert.equal(pluginTools(tmp), null);
const old = path.join(tmp, 'cache', 'old'), neu = path.join(tmp, 'cache', 'new');
mk(path.join(old, 'tools', 'office.mjs')); mk(path.join(neu, 'tools', 'office.mjs'));
mk(path.join(tmp, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: {
  'ai-office@a': [{ installPath: old, version: '0.1.0', lastUpdated: '2026-11-13T00:00:00Z' }],
  'ai-office@b': [{ installPath: neu, version: '0.10.0', lastUpdated: '2026-11-12T00:00:00Z' }],
  'other@a': [{ installPath: tmp, lastUpdated: '2027-01-01T00:00:00Z' }] } }));
assert.equal(pluginTools(tmp), path.join(neu, 'tools'));

// 다른 파일만 덮어쓰고, 프로젝트에만 있는 파일은 둔다
const src = path.join(tmp, 'src'), dst = path.join(tmp, 'dst');
mk(path.join(src, 'a.mjs'), 'new'); mk(path.join(src, 'same.mjs'), 'x'); mk(path.join(src, 'fixtures', 'f.jsonl'), 'f');
mk(path.join(dst, 'a.mjs'), 'old'); mk(path.join(dst, 'same.mjs'), 'x'); mk(path.join(dst, 'mine.txt'), 'keep');
assert.deepEqual(syncDir(src, dst).sort(), ['a.mjs', 'fixtures/f.jsonl']);
assert.equal(readFileSync(path.join(dst, 'a.mjs'), 'utf8'), 'new');
assert.equal(readFileSync(path.join(dst, 'mine.txt'), 'utf8'), 'keep');
assert.deepEqual(syncDir(src, dst), []);

// 버전: 숫자 단위로 비교
assert.ok(newer('0.10.0', '0.9.9')); assert.ok(!newer('0.2.0', '0.2.0')); assert.ok(newer('0.1.0', '0')); assert.ok(!newer(null, '0'));

// updateTools: 플러그인 버전이 더 높을 때만 맞추고 표시를 남긴다. 같거나 낮으면 손대지 않는다(내려가지 않게)
mk(path.join(neu, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '0.10.0' }));
mk(path.join(neu, 'tools', 'office.html'), 'v10');
const proj = path.join(tmp, 'proj', 'tools');
mk(path.join(proj, 'office.html'), 'v1');
assert.deepEqual(updateTools(proj, tmp), { version: '0.10.0', changed: ['office.html', 'office.mjs'] });
assert.equal(readFileSync(path.join(proj, '.plugin-version'), 'utf8').trim(), '0.10.0');
writeFileSync(path.join(proj, 'office.html'), 'newer local');
assert.equal(updateTools(proj, tmp), null);
assert.equal(readFileSync(path.join(proj, 'office.html'), 'utf8'), 'newer local');
console.log('update ok');
