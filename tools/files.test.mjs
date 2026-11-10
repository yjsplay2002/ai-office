// node tools/files.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { mediaFile, byteRange } from './files.mjs';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'files-test-'));
const root = path.join(tmp, 'repo'), outside = path.join(tmp, 'outside');
for (const f of ['board/x.png', 'board/Y.PNG', 'game/tools/a.html', 'board/v.webm', 'board/.env.png', 'board/notes.md',
  'node_modules/a/b.png', '.git/c.png', '.dev.vars.png', 'board/a.key']) {
  mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
  writeFileSync(path.join(root, f), 'x');
}
mkdirSync(outside); writeFileSync(path.join(outside, 'secret.png'), 'x');
let linked = true;
try { symlinkSync(outside, path.join(root, 'board', 'link'), 'junction'); } catch { linked = false; }

const ok = (rel) => mediaFile(root, rel)?.type;
assert.equal(ok('board/x.png'), 'image/png');
assert.equal(ok('board/Y.PNG'), 'image/png');
assert.equal(ok('game/tools/a.html'), 'text/html; charset=utf-8');
assert.equal(ok('board/v.webm'), 'video/webm');
assert.equal(ok('board\\x.png'), 'image/png');
for (const bad of ['', '../outside/secret.png', 'board/../../outside/secret.png', 'board/../board/x.png', '/board/x.png', '\\board\\x.png',
  path.join(root, 'board/x.png'), 'C:/Windows/x.png', 'c:board/x.png', 'board/x.png\0', 'board/notes.md', 'board/missing.png', 'board',
  'board/.env.png', '.dev.vars.png', '.git/c.png', 'node_modules/a/b.png', 'board/a.key', '.office-telegram.env', '.env'])
  assert.equal(mediaFile(root, bad), null, bad);
if (linked) assert.equal(mediaFile(root, 'board/link/secret.png'), null, 'junction escape');

assert.equal(byteRange(undefined, 100), null);
assert.equal(byteRange('bytes=-', 100), null);
assert.deepEqual(byteRange('bytes=0-', 100), { start: 0, end: 99 });
assert.deepEqual(byteRange('bytes=10-19', 100), { start: 10, end: 19 });
assert.deepEqual(byteRange('bytes=90-500', 100), { start: 90, end: 99 });
assert.deepEqual(byteRange('bytes=-30', 100), { start: 70, end: 99 });
assert.equal(byteRange('bytes=100-', 100), false);
assert.equal(byteRange('bytes=20-10', 100), false);
rmSync(tmp, { recursive: true, force: true });
console.log(`files ok${linked ? '' : ' (junction test skipped)'}`);
