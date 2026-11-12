// 직원별 토큰 사용량: Claude Code가 남기는 세션 기록(~/.claude/projects/<slug>/)을 그대로 집계한다.
// 메인 세션 = pm, <session>/subagents/agent-*.jsonl = .meta.json의 agentType.
// 같은 폴더에서 돈 세션 중 이 오피스가 띄운 것(.office-runs/sessions.txt, tools/office.mjs가 기록)만 센다.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const projectDir = (root) => path.join(os.homedir(), '.claude', 'projects', root.replace(/[^A-Za-z0-9]/g, '-'));

const cache = new Map(); // file -> { key, parsed: { days, last } }

// One transcript -> { days: tokens per local day, last: { model, t } = the newest real model id the API answered with }.
// Each streamed block repeats the message id; the last copy has final usage.
export function parseTranscript(text) {
  const byId = new Map();
  let last = null;
  for (const l of text.split('\n')) {
    if (!l.includes('"usage"')) continue;
    let e; try { e = JSON.parse(l); } catch { continue; }
    const u = e.type === 'assistant' && e.message?.usage;
    if (!u) continue;
    const m = e.message.model;   // '<synthetic>' = Claude Code's own error lines, not a model
    if (m && m !== '<synthetic>' && (!last || (e.timestamp || '') >= last.t)) last = { model: m, t: e.timestamp || '' };
    byId.set(e.message.id || e.uuid, { t: e.timestamp, u });
  }
  const days = {};
  for (const { t, u } of byId.values()) {
    const d = t ? new Date(t).toLocaleDateString('sv') : 'unknown'; // sv locale = YYYY-MM-DD in local time
    const s = (days[d] ||= { in: 0, cache: 0, out: 0 });
    s.in += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    s.cache += u.cache_read_input_tokens || 0;
    s.out += u.output_tokens || 0;
  }
  return { days, last };
}

function parsedOf(file) {
  const st = statSync(file);
  const key = `${st.mtimeMs}:${st.size}`;
  const hit = cache.get(file);
  if (hit?.key === key) return hit.parsed;
  const parsed = parseTranscript(readFileSync(file, 'utf8'));
  cache.set(file, { key, parsed });
  return parsed;
}

export const officeSessions = (root) => { try { return new Set(readFileSync(path.join(root, '.office-runs', 'sessions.txt'), 'utf8').split(/\s+/).filter(Boolean)); } catch { return new Set(); } };

function files(dir, ids) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!ids.has(f.replace(/\.jsonl$/, ''))) continue;
    const p = path.join(dir, f);
    if (f.endsWith('.jsonl')) { out.push({ file: p, agent: 'pm' }); continue; }
    const sub = path.join(p, 'subagents');
    if (!existsSync(sub)) continue;
    for (const a of readdirSync(sub)) {
      if (!a.endsWith('.jsonl')) continue;
      let agent = 'general-purpose';
      try { agent = JSON.parse(readFileSync(path.join(sub, a.replace(/\.jsonl$/, '.meta.json')), 'utf8')).agentType || agent; } catch {}
      out.push({ file: path.join(sub, a), agent });
    }
  }
  return out;
}

// -> [{ agent, model, today, week, total }] each {in, cache, out}, biggest total first. model = newest actual model id ('' if none yet).
export function usage(root, now = new Date()) {
  const today = now.toLocaleDateString('sv');
  const weekAgo = new Date(now - 6 * 864e5).toLocaleDateString('sv');
  const per = {};
  const add = (s, d) => { s.in += d.in; s.cache += d.cache; s.out += d.out; };
  for (const { file, agent } of files(projectDir(root), officeSessions(root))) {
    const a = (per[agent] ||= { agent, today: { in: 0, cache: 0, out: 0 }, week: { in: 0, cache: 0, out: 0 }, total: { in: 0, cache: 0, out: 0 } });
    const { days, last } = parsedOf(file);
    if (last && last.t >= (a.t || '')) { a.model = last.model; a.t = last.t; }
    for (const [d, s] of Object.entries(days)) {
      add(a.total, s);
      if (d >= weekAgo) add(a.week, s);
      if (d === today) add(a.today, s);
    }
  }
  const sum = (s) => s.in + s.cache + s.out;
  return Object.values(per).map(({ t, ...r }) => ({ model: '', ...r })).sort((x, y) => sum(y.total) - sum(x.total));
}
