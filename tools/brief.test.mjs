// node tools/brief.test.mjs — 현황 요약.
import assert from 'node:assert/strict';
import { brief } from './brief.mjs';

const todos = [
  '# 대표 TODO', '',
  '### T1 · 결정 · plan', '가격', '- 옵션: A / B', '- 상태: 대기', '',
  '### T2 · 승인 · dev', '빌드 제출', '- 상태: 완료 2026-11-19', '- 답: 승인', '',
  '### T3 · 결정 · plan', '이름', '- 상태: 대기', '',
  '### T4 · 확인 · pm', '보고를 확인해 주세요', '- 상태: 대기', '',
].join('\n');
const now = new Date(2026, 10, 20, 9, 0).getTime();   // 로컬 2026-11-20 09:00
const log = [
  '# 로그', '',
  '## 2026-11-13', '- 너무 옛날', '',
  '## 2026-11-14', '- 7일 전 첫날', '  - 하위 줄', '',
  '## 2026-11-20', '- 오늘 일', '- 둘째', '  - 하위', '본문 줄', '',
  '## 2026-11-21', '- 내일(미래)', '',
].join('\r\n');
const h = 3600e3;
const files = [
  { path: 'board/todos.md', mtime: now - 100 * h },
  { path: 'board/log.md', mtime: now - 100 * h },
  { path: 'board/decisions.md', mtime: now - 100 * h },
  { path: 'board/plans/b.md', mtime: now - 72 * h },
  { path: 'board/plans/a.md', mtime: now - 200 * h },
  { path: 'board/plans/new.md', mtime: now - 71 * h },
  { path: 'other/x.md', mtime: 0 },
  { path: 'board/research/.gitkeep', mtime: 0 },   // 숨김 파일은 제외
];
const r = brief({ todos, log, files, now });
assert.deepEqual(r.open, { total: 3, byType: { 결정: 2, 확인: 1 } });
assert.deepEqual(r.recent, [
  { date: '2026-11-20', items: ['오늘 일', '둘째'] },
  { date: '2026-11-14', items: ['7일 전 첫날'] },
]);
assert.deepEqual(r.stale, ['board/plans/a.md', 'board/plans/b.md']);
assert.deepEqual(brief({ todos: '', log: '', files: [], now }), { open: { total: 0, byType: {} }, recent: [], stale: [] });
console.log('brief ok');
