// Turns raw `claude -p --output-format stream-json` lines into office events.
// Shared by the browser (office.html) and the self-check (map.test.mjs).

export function createMapper() {
  const agentOf = new Map(); // Agent tool_use id -> subagent name

  return function feed(e) {
    const out = [];
    const parent = e.parent_tool_use_id || null;
    const content = Array.isArray(e.message?.content) ? e.message.content : [];

    if (e.type === 'system' && e.subtype === 'init') out.push({ kind: 'start' });
    if (e.type === 'rate_limit_event' && e.rate_limit_info?.unifiedWindows) {
      const w = e.rate_limit_info.unifiedWindows;
      out.push({ kind: 'limit', five: w.five_hour?.utilization, seven: w.seven_day?.utilization });
    }

    if (e.type === 'assistant') for (const c of content) {
      if (c.type === 'text' && !parent && c.text.trim()) out.push({ kind: 'say', agent: 'pm', text: c.text });
      if (c.type !== 'tool_use') continue;
      if (!parent && (c.name === 'Agent' || c.name === 'Task')) {
        const agent = c.input?.subagent_type || 'general-purpose';
        agentOf.set(c.id, agent);
        out.push({ kind: 'dispatch', agent, task: c.input?.description || '' });
        continue;
      }
      const agent = parent ? agentOf.get(parent) || 'pm' : 'pm';
      out.push({ kind: 'tool', agent, tool: c.name, detail: brief(c.input) });
      const rel = (c.name === 'Write' || c.name === 'Edit') && boardRel(c.input?.file_path);
      if (rel) out.push({ kind: 'paper', agent, path: rel });
    }

    if (e.type === 'user' && !parent) for (const c of content) {
      if (c.type === 'tool_result' && agentOf.has(c.tool_use_id)) out.push({ kind: 'report', agent: agentOf.get(c.tool_use_id) });
    }

    if (e.type === 'result') out.push({ kind: 'result', text: e.result || '', turns: e.num_turns, error: !!e.is_error });
    return out;
  };
}

export function boardRel(fp) {
  if (!fp) return null;
  const n = '/' + fp.replace(/\\/g, '/');
  const i = n.indexOf('/board/');
  return i < 0 ? null : n.slice(i + 1);
}

function brief(input = {}) {
  const v = input.query || input.url || input.pattern || input.command || input.file_path || input.description || '';
  const s = String(v).replace(/\\/g, '/').split('/').slice(-2).join('/');
  return s.length > 40 ? s.slice(0, 39) + '…' : s;
}
