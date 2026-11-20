// 현황 요약: 열린 TODO 수, 최근 7일 로그, 3일 넘게 안 바뀐 board 파일. 순수 함수(파일은 office.mjs가 읽어 넘김).
import { parseTodos, TYPES } from './todos.mjs';

const KEEP = new Set(['board/todos.md', 'board/log.md', 'board/decisions.md']);
const STALE_MS = 72 * 3600e3;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function brief({ todos = '', log = '', files = [], now = Date.now() }) {
  const open = parseTodos(String(todos)).filter((t) => !t.done);
  const byType = Object.fromEntries(TYPES.map((k) => [k, open.filter((t) => t.type === k).length]).filter(([, n]) => n));
  // 로컬 날짜로 오늘~오늘-6일
  const days = new Set(Array.from({ length: 7 }, (_, i) => { const d = new Date(now); d.setDate(d.getDate() - i); return ymd(d); }));
  const recent = String(log).split(/^## /m).slice(1).map((part) => {
    const [head, ...lines] = part.split(/\r?\n/);
    return { date: head.trim().slice(0, 10), items: lines.filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim()) };
  }).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date) && days.has(s.date)).sort((a, b) => b.date.localeCompare(a.date));
  const stale = files.filter((f) => f.path.startsWith('board/') && !/\/\.[^/]*$/.test(f.path) && !KEEP.has(f.path) && now - f.mtime >= STALE_MS).map((f) => f.path).sort();
  return { open: { total: open.length, byType }, recent, stale };
}
