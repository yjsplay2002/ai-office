// 직원 관리: .claude/agents/<id>.md 머리말(model, effort)과 표시 이름(description의 「…」)을 읽고 고친다.
// 고치는 줄 말고는 파일을 바이트 그대로 둔다. name:(아이디)은 절대 바꾸지 않는다. PM은 .claude/ai-office.json.

export const MODELS = ['inherit', 'opus', 'sonnet', 'haiku', 'fable'];   // Claude Code 에이전트 머리말 model: 값
export const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];     // '' = 줄 없음(기본)
export const PM_DEFAULT = { name: '지휘', model: 'inherit', effort: '' };

const FM = /^(---\r?\n)([\s\S]*?)(\r?\n---)/;

export function checkName(name) {
  const s = String(name ?? '').trim();
  if (!s || s.length > 12 || /[\r\n「」]/.test(s)) throw new Error('이름은 1~12자, 줄바꿈과 「」 없이');
  return s;
}
export function checkModel(m) { if (!MODELS.includes(m)) throw new Error(`모델은 ${MODELS.join(' / ')} 중 하나`); return m; }
export function checkEffort(e) { if (!EFFORTS.includes(e)) throw new Error(`노력 수준은 ${EFFORTS.filter(Boolean).join(' / ')} 또는 기본`); return e; }

// "개발 「빌드」. 웹 게임을…" -> { role: '개발', name: '빌드', rest: '웹 게임을…' }. 「」가 없으면 첫 낱말이 역할.
export function splitDesc(desc) {
  const v = String(desc || '').replace(/^\s*["']|["']\s*$/g, '');
  const m = v.match(/^(.*?)\s*「([^」]*)」[.\s]*([\s\S]*)$/);
  if (m) return { role: m[1].trim(), name: m[2], rest: m[3].trim() };
  const w = v.match(/^([^\s.,]+)[.,]?\s*([\s\S]*)$/) || [, v, ''];
  return { role: w[1], name: '', rest: w[2].trim() };
}

// The description line with the display name set: replace 「…」, or put 「name」 right after the role word.
export function withName(line, name) {
  if (/「[^」]*」/.test(line)) return line.replace(/「[^」]*」/, `「${name}」`);
  return line.replace(/^(description:\s*["']?)([^\s.,"']+)/, `$1$2 「${name}」`);
}

export function readAgent(text, id) {
  const m = FM.exec(text) || [, , ''];
  const get = (k) => (m[2].match(new RegExp(`^${k}:\\s*(.*)$`, 'm')) || [])[1]?.trim() || '';
  const d = splitDesc(get('description'));
  return { id, role: d.role, name: d.name, desc: d.rest.split(/(?<=[.!?。])\s/)[0] || '', model: get('model') || 'inherit', effort: get('effort') };
}

// change = { model?, effort?, name? } (undefined = leave as is). Returns the new file text.
export function editAgent(text, change) {
  const m = FM.exec(text);
  if (!m) throw new Error('에이전트 파일 머리말(---)이 없음');
  const nl = m[2].includes('\r\n') ? '\r\n' : '\n';
  const lines = m[2].split(/\r?\n/);
  const at = (k) => lines.findIndex((l) => l.startsWith(`${k}:`));
  const set = (k, v) => {
    const i = at(k);
    if (!v) { if (i >= 0) lines.splice(i, 1); return; }   // 기본으로: 줄을 뺀다
    if (i >= 0) lines[i] = `${k}: ${v}`; else lines.push(`${k}: ${v}`);
  };
  if (change.model !== undefined) {
    const v = checkModel(change.model);
    if (!(v === 'inherit' && at('model') < 0)) set('model', v);   // 줄이 없을 때 inherit이면 그대로(이미 상속)
  }
  if (change.effort !== undefined) set('effort', checkEffort(change.effort));
  if (change.name !== undefined) {
    const v = checkName(change.name), i = at('description');
    if (i < 0) throw new Error('description 줄이 없어 이름을 넣을 수 없음');
    lines[i] = withName(lines[i], v);
  }
  return m[1] + lines.join(nl) + m[3] + text.slice(m[0].length);
}

// PM 설정 파일 내용(없거나 깨졌으면 기본값) / 고친 내용
export function readPm(text) {
  let o = {};
  try { o = JSON.parse(text || '{}').pm || {}; } catch {}
  return { ...PM_DEFAULT, ...Object.fromEntries(Object.entries(o).filter(([k]) => k in PM_DEFAULT)) };
}
export function editPm(text, change) {
  let all = {};
  try { all = JSON.parse(text || '{}'); } catch {}
  const pm = readPm(text);
  if (change.model !== undefined) pm.model = checkModel(change.model);
  if (change.effort !== undefined) pm.effort = checkEffort(change.effort);
  if (change.name !== undefined) pm.name = checkName(change.name);
  return JSON.stringify({ ...all, pm }, null, 2) + '\n';
}
// claude -p 인자: inherit·기본이면 아무것도 넘기지 않는다
export const pmArgs = (pm) => [...(pm.model && pm.model !== 'inherit' ? ['--model', pm.model] : []), ...(pm.effort ? ['--effort', pm.effort] : [])];
