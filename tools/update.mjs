// 플러그인을 업데이트하면 프로젝트의 tools/(init 때 받은 복사본)도 따라가게 한다.
// 대시보드 감독 프로세스(office.mjs)가 서버를 띄울 때마다 설치된 ai-office 플러그인의 tools/와 맞춘다.
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Claude Code에 설치된 ai-office 플러그인의 tools/ (여럿이면 버전이 가장 높은 것, 같으면 최근 것). 없으면 null.
export function pluginTools(home = os.homedir()) {
  let j;
  try { j = JSON.parse(readFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8')); } catch { return null; }
  return Object.entries(j.plugins ?? j).filter(([k]) => k.startsWith('ai-office@')).flatMap(([, v]) => (Array.isArray(v) ? v : []))
    .sort((a, b) => (newer(b.version, a.version) ? 1 : newer(a.version, b.version) ? -1 : String(b.lastUpdated ?? '').localeCompare(String(a.lastUpdated ?? ''))))
    .map((e) => path.join(String(e.installPath ?? ''), 'tools')).find((d) => existsSync(path.join(d, 'office.mjs'))) ?? null;
}

// src의 파일 중 dst와 내용이 다른 것만 덮어쓴다(dst에만 있는 파일은 둔다). 바뀐 상대 경로 목록을 돌려준다.
export function syncDir(src, dst) {
  const changed = [];
  const walk = (rel) => {
    const s = path.join(src, rel);
    if (statSync(s).isDirectory()) return readdirSync(s).forEach((f) => walk(path.join(rel, f)));
    const d = path.join(dst, rel), buf = readFileSync(s);
    if (existsSync(d) && readFileSync(d).equals(buf)) return;
    mkdirSync(path.dirname(d), { recursive: true });
    writeFileSync(d, buf);
    changed.push(rel.replace(/\\/g, '/'));
  };
  walk('');
  return changed;
}

// 'x.y.z' 비교: a가 b보다 높으면 true
export function newer(a, b) {
  const x = String(a ?? '0').split('.').map(Number), y = String(b ?? '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}
export const versionOf = (toolsDir) => { try { return JSON.parse(readFileSync(path.join(toolsDir, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version ?? null; } catch { return null; } };

// 프로젝트 tools/(dir)를 설치된 플러그인에 맞춘다. 플러그인 버전이 tools/.plugin-version보다 높을 때만(내려가지 않게).
// -> { version, changed } 또는 null(할 일 없음)
export function updateTools(dir, home = os.homedir()) {
  const src = pluginTools(home), want = src && versionOf(src), mark = path.join(dir, '.plugin-version');
  const have = existsSync(mark) ? readFileSync(mark, 'utf8').trim() : '0';
  if (!want || !newer(want, have) || path.resolve(src) === path.resolve(dir)) return null;
  const changed = syncDir(src, dir);
  writeFileSync(mark, want + '\n');
  return { version: want, changed };
}
