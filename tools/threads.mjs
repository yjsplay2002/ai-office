import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Only lifecycle metadata and undelivered comments survive history trimming.
export function threadStore(file) {
  const state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { runs: {}, pending: [] };
  const save = () => {
    writeFileSync(file + '.tmp', JSON.stringify(state));
    renameSync(file + '.tmp', file);
  };
  const pending = (thread) => state.pending.filter((entry) => entry.thread === thread);
  function enqueue(thread, agent, text, slack, urgent = false) {
    const item = { id: randomUUID(), thread, agent, text, slack, urgent };
    if (urgent) state.pending.unshift(item); else state.pending.push(item);
    save();
  }
  function discard(thread) {
    state.pending = thread == null ? [] : state.pending.filter((e) => e.thread !== thread);
    save();
  }
  function batch(thread) {
    const items = pending(thread), first = items[0];
    if (!first) return [];
    if (first.urgent) return [first];
    const cut = items.findIndex((e) => e.agent !== first.agent);
    return cut < 0 ? items : items.slice(0, cut);
  }
  function record(e, persist = true) {
    if (!Number.isInteger(e._run) || e.parent_tool_use_id) return;
    let r = state.runs[e._run];
    if (e.type === '_office' && e.prompt) {
      r ??= state.runs[e._run] = {};
      Object.assign(r, { thread: e.thread ?? e._run, start: e._t, agent: e.agent || 'pm' });
      if (e.comments?.length) {
        const sent = new Set(e.comments);
        state.pending = state.pending.filter((c) => !sent.has(c.id));
      }
    } else if (!r) return;
    else if (e.type === 'system' && e.subtype === 'init') r.session = e.session_id;
    else if (e.type === 'user' && e.tool_use_result?.agentType === 'dev' && e.tool_use_result.agentId) {
      const worker = e.tool_use_result;
      r.devAgent = worker.canContinueAgent !== false && /^[\w-]+$/.test(worker.agentId) ? worker.agentId : null;
    } else if (e.type === 'result' && e.num_turns !== 0) {
      if (e._t && !r.end) r.resultTime = e._t;
      if (!Object.keys(e.model_usage_since_last_result || {}).length) {
        if (persist) save();
        return;
      }
      // modelUsage may include earlier resumed runs. The delta includes PM and workers.
      const models = Object.values(e.model_usage_since_last_result);
      r.tokens = models.reduce((s, u) => ({
        in: s.in + (u.inputTokens || 0), write: s.write + (u.cacheCreationInputTokens || 0),
        cache: s.cache + (u.cacheReadInputTokens || 0), out: s.out + (u.outputTokens || 0),
      }), { in: 0, write: 0, cache: 0, out: 0 });
      if (e.subagent_stats?.by_type) r.dev = e.subagent_stats.by_type.dev || 0;
    }
    else if (e.type === '_office' && e.ended) r.end = e._t;
    else return;
    if (persist) save();
  }
  function lastDev(session) {
    return Object.values(state.runs).reverse().find((r) => r.session === session && Object.hasOwn(r, 'devAgent'))?.devAgent;
  }
  return { state, pending, batch, enqueue, discard, record, save, lastDev };
}
