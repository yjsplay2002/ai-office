// Turns raw `claude -p --output-format stream-json` lines into office events.
// Shared by the browser (office.html) and the self-checks (map.test.mjs, history.test.mjs).

// Tool -> history step kind (office.html colours them). Anything else counts as 'run'.
const STEP = { Read: 'read', Grep: 'read', Glob: 'read', WebSearch: 'search', WebFetch: 'search', Write: 'write', Edit: 'write', NotebookEdit: 'write' };
const full = (s) => String(s || '').trim();   // history keeps whole texts; the card clamps them in CSS
export const line = (s, n = 140) => { const l = String(s || '').split('\n').map((x) => x.trim()).find(Boolean) || ''; return l.length > n ? l.slice(0, n - 1) + '…' : l; };

export function createMapper() {
  // Agent tool_use id -> { agent, bg }. Every line a subagent writes carries parent_tool_use_id = that id
  // (checked on real runs: foreground and run_in_background agents alike).
  const agentOf = new Map();
  const done = new Set();   // Agent ids already reported: a foreground agent gets both task_notification and tool_result

  return function feed(e) {
    const out = [];
    const parent = e.parent_tool_use_id || null;
    const content = Array.isArray(e.message?.content) ? e.message.content : [];
    // Nested agents (a subagent's own Agent call) are not in agentOf; their lines still name their type.
    const who = parent ? agentOf.get(parent)?.agent || e.subagent_type || 'pm' : 'pm';
    const finish = (id, ok, summary) => {
      if (done.has(id)) return;
      done.add(id);
      out.push({ kind: 'report', agent: agentOf.get(id).agent, id, ok, summary });
    };

    if (e.type === 'system' && e.subtype === 'init') out.push({ kind: 'start' });
    if (e.type === 'rate_limit_event' && e.rate_limit_info?.unifiedWindows) {
      const w = e.rate_limit_info.unifiedWindows;
      out.push({ kind: 'limit', five: w.five_hour?.utilization, seven: w.seven_day?.utilization });
    }

    if (e.type === 'assistant') for (const c of content) {
      if (c.type === 'text' && c.text.trim()) out.push({ kind: 'say', agent: who, id: parent, text: c.text });
      if (c.type !== 'tool_use') continue;
      if (!parent && (c.name === 'Agent' || c.name === 'Task')) {
        const agent = c.input?.subagent_type || 'general-purpose';
        agentOf.set(c.id, { agent, bg: !!c.input?.run_in_background });
        out.push({ kind: 'dispatch', agent, id: c.id, task: c.input?.description || '', prompt: full(c.input?.prompt) });
        continue;
      }
      const rel = boardRel(c.input?.file_path);
      out.push({ kind: 'tool', agent: who, id: parent, tool: c.name, detail: brief(c.input), step: STEP[c.name] || 'run', path: rel || undefined });
      if (rel && (c.name === 'Write' || c.name === 'Edit')) out.push({ kind: 'paper', agent: who, path: rel });
    }

    // Only notifications for Agent calls count; most task_* lines are a subagent's own Bash tasks.
    if (e.type === 'system' && e.subtype === 'task_notification' && agentOf.has(e.tool_use_id)) finish(e.tool_use_id, e.status === 'completed', full(e.summary));

    if (e.type === 'user' && !parent) for (const c of content) {
      const a = c.type === 'tool_result' && agentOf.get(c.tool_use_id);
      if (!a) continue;
      // A background agent's tool_result only says it was launched; it is finished by its task_notification.
      if (a.bg && !c.is_error) continue;
      finish(c.tool_use_id, !c.is_error, c.is_error ? full(typeof c.content === 'string' ? c.content : c.content?.[0]?.text) : '');
    }

    if (e.type === 'result') out.push({ kind: 'result', text: e.result || '', turns: e.num_turns, error: !!e.is_error });
    return out;
  };
}

// Task cards behind each person: key = Agent tool_use id, or 'run:<n>' for the PM's own run.
// ev = [time, kind, text, path?] with kind order|read|search|run|write|say|report.
export function createHistory(max = 200) {
  const tasks = new Map();
  const same = (a, b) => String(a).replace(/\s+/g, ' ').trim() === String(b).replace(/\s+/g, ' ').trim();
  // A memo or report that repeats earlier text (the final result usually repeats the last assistant message) is not added again.
  const dup = (k, [, kind, text]) => {
    if (kind !== 'say' && kind !== 'report') return false;
    if (k.ev.some((e) => same(e[2], text))) return true;
    let i = k.ev.length; while (i > 0 && k.ev[i - 1][1] === 'say') i--;   // or the last few memos joined together
    return i < k.ev.length && same(k.ev.slice(i).map((e) => e[2]).join(' '), text);
  };
  const push = (k, row) => { if (!k || dup(k, row)) return; k.ev.push(row); if (k.ev.length > max) k.ev.splice(1, 1); };   // keep the order line
  const runKey = (n) => `run:${n}`;
  return {
    tasks,
    // thread = the run whose thread this one continues (a CEO comment); a new instruction is its own thread.
    run(n, prompt, t, thread = n) { tasks.set(runKey(n), { agent: 'pm', run: n, thread, title: line(prompt, 60), start: t, state: '진행 중', ev: [[t, 'order', `대표: ${full(prompt)}`]] }); },
    // Run finished or cancelled (why = '중단'): whatever never reported is closed too.
    end(n, why) { for (const k of tasks.values()) if (k.run === n && k.state === '진행 중') k.state = why || (k.agent === 'pm' ? '완료' : '보고 없이 끝남'); },
    feed(ev, t, n) {
      const k = tasks.get(ev.id || runKey(n));
      if (ev.kind === 'dispatch') {
        tasks.set(ev.id, { agent: ev.agent, run: n, thread: tasks.get(runKey(n))?.thread ?? n, title: ev.task || ev.agent, start: t, state: '진행 중', ev: [[t, 'order', ev.prompt || ev.task]] });
        push(tasks.get(runKey(n)), [t, 'run', `${ev.agent}에게 맡김: ${ev.task}`]);
      }
      if (ev.kind === 'tool') push(k, [t, ev.step, ev.detail || ev.tool, ev.path]);
      if (ev.kind === 'say') push(k, [t, 'say', full(ev.text)]);
      if (ev.kind === 'report' && k) { k.state = ev.ok ? '완료' : '실패'; push(k, [t, 'report', ev.summary || k.state]); }
      if (ev.kind === 'result' && k) { k.state = ev.error ? '실패' : '완료'; push(k, [t, 'report', full(ev.text) || '최종 보고']); }
    },
    // Every line of a thread in time order, each with its speaker: the CEO gives the PM's orders, the PM gives staff theirs.
    thread(id) {
      return [...tasks.values()].filter((k) => k.thread === id)
        .flatMap((k) => k.ev.map(([t, kind, text, path]) => kind !== 'order' ? { t, kind, text, path, who: k.agent }
          : k.agent === 'pm' ? { t, kind, text: String(text).replace(/^대표: /, ''), who: 'ceo' } : { t, kind, text, who: 'pm', to: k.agent }))
        .sort((a, b) => a.t - b.t);
    },
    // The card to show for a person: a running one first (runs overlap), else the newest.
    latest(agent) { let best = null; for (const k of tasks.values()) if (k.agent === agent && (!best || ((k.state === '진행 중') - (best.state === '진행 중') || (k.start >= best.start ? 1 : -1)) > 0)) best = k; return best; },
  };
}

// What the 3D office acts out for a mapper event (office.html runs it; history replays skip it).
// walk = who goes to whom: give = carries a paper there, take = brings one back. work = what they are doing at the desk.
export function motionOf(ev) {
  if (ev.kind === 'dispatch') return { walk: { who: 'pm', to: ev.agent, give: 'order' } };   // PM hands the work order over
  if (ev.kind === 'report') return { walk: { who: ev.agent, to: 'pm', give: 'report' } };     // staff bring their papers to PM
  if (ev.kind === 'result') return { walk: { who: 'pm', to: 'ceo', give: 'final' } };         // PM brings the final report to the CEO
  if (ev.kind === 'tool') return { work: { who: ev.agent, act: ev.step } };
  if (ev.kind === 'say') return { work: { who: ev.agent, act: 'say' } };
  if (ev.kind === 'paper') return { file: { who: ev.agent, path: ev.path } };                 // a board/ file lands on their desk
  return null;
}
export const instructionMotion = () => ({ walk: { who: 'pm', to: 'ceo', take: 'instruction' } });   // PM fetches a new CEO order
export const todoMotion = (todo, staff) => ({ walk: { who: staff.includes(todo.by) ? todo.by : 'pm', to: 'ceo', give: 'todo' } });

// Shortest walk on a grid of floor cells (8 directions, no cutting corners past furniture). null = unreachable.
export function gridPath(n, free, [si, sj], [gi, gj]) {
  const g = new Float64Array(n * n).fill(Infinity), from = new Int32Array(n * n).fill(-1), done = new Uint8Array(n * n);
  const f = (c) => g[c] + Math.hypot((c / n | 0) - gi, (c % n) - gj), open = [si * n + sj];
  g[open[0]] = 0;
  while (open.length) {
    let b = 0;
    for (let k = 1; k < open.length; k++) if (f(open[k]) < f(open[b])) b = k;
    const cur = open.splice(b, 1)[0], ci = cur / n | 0, cj = cur % n;
    if (done[cur]) continue;
    done[cur] = 1;
    if (ci === gi && cj === gj) { const out = []; for (let c = cur; c >= 0; c = from[c]) out.unshift([c / n | 0, c % n]); return out; }
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const i = ci + di, j = cj + dj;
      if ((!di && !dj) || i < 0 || j < 0 || i >= n || j >= n || !free(i, j)) continue;
      if (di && dj && (!free(ci + di, cj) || !free(ci, cj + dj))) continue;
      const k = i * n + j, ng = g[cur] + (di && dj ? Math.SQRT2 : 1);
      if (ng < g[k]) { g[k] = ng; from[k] = cur; open.push(k); }
    }
  }
  return null;
}

export function boardRel(fp) {
  if (!fp) return null;
  const n = '/' + fp.replace(/\\/g, '/');
  const i = n.indexOf('/board/');
  return i < 0 ? null : n.slice(i + 1);
}

// One short line per tool call. Bash's own description reads better than the command.
function brief(input = {}) {
  const v = input.description || input.query || input.pattern || input.command;
  const s = v ? line(v, 999) : String(input.file_path || input.url || '').replace(/\\/g, '/').split('/').slice(-2).join('/');
  return s.length > 60 ? s.slice(0, 59) + '…' : s;
}
