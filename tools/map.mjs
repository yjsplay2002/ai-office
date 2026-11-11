// Turns raw `claude -p --output-format stream-json` lines into office events.
// Shared by the browser (office.html) and the self-checks (map.test.mjs, history.test.mjs).

// Tool -> history step kind (office.html colours them). Anything else counts as 'run'.
const STEP = { Read: 'read', Grep: 'read', Glob: 'read', WebSearch: 'search', WebFetch: 'search', Write: 'write', Edit: 'write', NotebookEdit: 'write' };
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
        out.push({ kind: 'dispatch', agent, id: c.id, task: c.input?.description || '', prompt: line(c.input?.prompt) });
        continue;
      }
      const rel = boardRel(c.input?.file_path);
      out.push({ kind: 'tool', agent: who, id: parent, tool: c.name, detail: brief(c.input), step: STEP[c.name] || 'run', path: rel || undefined });
      if (rel && (c.name === 'Write' || c.name === 'Edit')) out.push({ kind: 'paper', agent: who, path: rel });
    }

    // Only notifications for Agent calls count; most task_* lines are a subagent's own Bash tasks.
    if (e.type === 'system' && e.subtype === 'task_notification' && agentOf.has(e.tool_use_id)) finish(e.tool_use_id, e.status === 'completed', line(e.summary));

    if (e.type === 'user' && !parent) for (const c of content) {
      const a = c.type === 'tool_result' && agentOf.get(c.tool_use_id);
      if (!a) continue;
      // A background agent's tool_result only says it was launched; it is finished by its task_notification.
      if (a.bg && !c.is_error) continue;
      finish(c.tool_use_id, !c.is_error, c.is_error ? line(typeof c.content === 'string' ? c.content : c.content?.[0]?.text) : '');
    }

    if (e.type === 'result') out.push({ kind: 'result', text: e.result || '', turns: e.num_turns, error: !!e.is_error });
    return out;
  };
}

// Task cards behind each person: key = Agent tool_use id, or 'run:<n>' for the PM's own run.
// ev = [time, kind, text, path?] with kind order|read|search|run|write|say|report.
export function createHistory(max = 200) {
  const tasks = new Map();
  const push = (k, row) => { if (!k) return; k.ev.push(row); if (k.ev.length > max) k.ev.splice(1, 1); };   // keep the order line
  const runKey = (n) => `run:${n}`;
  return {
    tasks,
    run(n, prompt, t) { tasks.set(runKey(n), { agent: 'pm', run: n, title: line(prompt, 60), start: t, state: '진행 중', ev: [[t, 'order', `대표: ${line(prompt)}`]] }); },
    // Run finished or cancelled: whatever never reported is closed too.
    end(n) { for (const k of tasks.values()) if (k.run === n && k.state === '진행 중') k.state = k.agent === 'pm' ? '완료' : '보고 없이 끝남'; },
    feed(ev, t, n) {
      const k = tasks.get(ev.id || runKey(n));
      if (ev.kind === 'dispatch') {
        tasks.set(ev.id, { agent: ev.agent, run: n, title: ev.task || ev.agent, start: t, state: '진행 중', ev: [[t, 'order', ev.prompt || ev.task]] });
        push(tasks.get(runKey(n)), [t, 'run', `${ev.agent}에게 맡김: ${ev.task}`]);
      }
      if (ev.kind === 'tool') push(k, [t, ev.step, ev.detail || ev.tool, ev.path]);
      if (ev.kind === 'say') push(k, [t, 'say', line(ev.text)]);
      if (ev.kind === 'report' && k) { k.state = ev.ok ? '완료' : '실패'; push(k, [t, 'report', ev.summary || k.state]); }
      if (ev.kind === 'result' && k) { k.state = ev.error ? '실패' : '완료'; push(k, [t, 'report', line(ev.text) || '최종 보고']); }
    },
    latest(agent) { let best = null; for (const k of tasks.values()) if (k.agent === agent && (!best || k.start >= best.start)) best = k; return best; },
  };
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
