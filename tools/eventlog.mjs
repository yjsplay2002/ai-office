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

// 대표가 TODO에 답해 시작한 실행은 새 스레드가 아니라 그 TODO를 올린 작업의 스레드에 붙는다.
// TODO를 올린 실행 = 그 TODO의 보고·근거 줄(board/reports/…-run<N>.md). 없으면 "(T200 후속)"의 T200을 따라간다. 못 찾으면 null.
export function todoThread(todo, lines, todos = [], seen = new Set()) {
  if (!todo || seen.has(todo.id)) return null;
  seen.add(todo.id);
  const run = Number(/-run(\d+)\.md$/.exec(todo.refs?.find((r) => /-run\d+\.md$/.test(r)) || '')?.[1]);
  if (run) for (const l of lines) {
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.type === '_office' && o.prompt && o._run === run) return o.thread ?? run;
  }
  const up = Number(/^\(T(\d+) 후속\)/.exec(todo.desc || '')?.[1]);
  return up ? todoThread(todos.find((t) => t.id === up), lines, todos, seen) : null;
}
export const ANSWER_HEAD = '대표가 TODO에 답했습니다:';
// 이 규칙 전에 남은 기록: TODO 답 실행을 원래 작업 스레드로 옮기고, 옮겨진 실행에 달린 댓글 실행도 따라 옮긴다.
// 순서대로 고쳐 나가므로 이어진 답도 따라간다.
export function linkAnswers(lines, todos) {
  const out = [...lines], moved = new Map();   // 옮긴 실행 -> 새 스레드
  out.forEach((l, i) => {
    let o; try { o = JSON.parse(l); } catch { return; }
    if (o.type !== '_office' || !o.prompt) return;
    if (o.thread != null) { if (moved.has(o.thread)) { out[i] = JSON.stringify({ ...o, thread: moved.get(o.thread) }); moved.set(o._run, moved.get(o.thread)); } return; }
    if (!String(o.prompt).startsWith(ANSWER_HEAD)) return;
    for (const [, id] of o.prompt.matchAll(/^- T(\d+) /gm)) {
      const th = todoThread(todos.find((t) => t.id === Number(id)), out.slice(0, i), todos);
      if (th != null && th !== o._run) { out[i] = JSON.stringify({ ...o, thread: th }); moved.set(o._run, th); return; }
    }
  });
  return out;
}
