// .office-runs/history.jsonl — every line the dashboard broadcast, so 대화 내역·보고함·히스토리 카드 survive a server restart.
// Pure helpers; tools/office.mjs does the file reads and writes.

export const KEEP_DAYS = 7, KEEP_LINES = 5000, SEND_LINES = 3000;

// File text -> lines to keep: parseable, newer than `days`, not from a run in `drop` (runs re-attached on boot re-send
// all their lines, so their old copies go), at most `max` (newest kept).
export function loadLog(text, { now = Date.now(), days = KEEP_DAYS, max = KEEP_LINES, drop = new Set() } = {}) {
  const since = now - days * 864e5, out = [];
  for (const l of String(text || '').split('\n')) {
    if (!l.trim()) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (!(o._t >= since) || drop.has(o._run)) continue;
    out.push(l.trim());
  }
  return out.slice(-max);
}

// Highest run id seen, so new runs never reuse an id that old lines (and history cards) are grouped by.
export const lastRun = (lines) => lines.reduce((n, l) => { try { return Math.max(n, Number(JSON.parse(l)._run) || 0); } catch { return n; } }, 0);
