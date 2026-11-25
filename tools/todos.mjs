// board/todos.md — 대표가 처리할 일. 형식은 CLAUDE.md의 "대표 TODO" 절 참고.
//
// ### T3 · 결정 · plan
// 가격 정책을 골라 주세요
// - 옵션: $14.99 / $19.99 / 무료+DLC
// - 근거: board/plans/2026-11-05-pricing.md
// - 상태: 대기

// 확인 = 대시보드 실행이 끝나 올라온 보고. 대표가 '종료'하거나 '추가 지시'로 이어서 시킨다.
export const TYPES = ['결정', '승인', '입력', '실행', '확인'];
export const CHECK = ['종료', '추가 지시'];
export const SUPERSEDED = '새 보고로 바뀜';   // 같은 스레드의 뒤 보고가 앞 '확인'을 대신함(답: "취소 (새 보고로 바뀜)")
export const RESOLVED = '스레드에서 처리됨';   // 대표가 스레드 댓글로 답했거나 팀이 끝내서 PM이 보고에 "처리된 TODO: T12"로 적은 TODO
// PM 최종 보고의 "처리된 TODO: T12, T13" 줄 -> [12, 13]
export const resolvedIds = (report) => [...(String(report || '').match(/^[\s*_>#-]*처리된 TODO[\s*_]*:(.*)$/m)?.[1] || '').matchAll(/T(\d+)/g)].map((m) => Number(m[1]));

export function parseTodos(text) {
  return text.split(/^### /m).slice(1).map((part) => {
    const [head, ...lines] = part.split(/\r?\n/);
    const m = head.match(/^T(\d+)\s*·\s*(결정|승인|입력|실행|확인)\s*·\s*(.+?)\s*$/);
    if (!m) return null;
    const field = (k) => (lines.find((l) => l.startsWith(`- ${k}:`)) || '').slice(k.length + 3).trim();
    const type = m[2];
    let options = field('옵션').split(' / ').map((s) => s.trim()).filter(Boolean);
    if (type === '승인' && !options.length) options = ['승인', '반려'];
    if (type === '확인') options = CHECK;
    const status = field('상태') || '대기';
    const desc = lines.filter((l) => l.trim() && !l.startsWith('- ') && !l.startsWith('  ')).join('\n').trim();
    const refs = refPaths(lines.filter((l) => /^- (근거|파일|QR|보고):/.test(l)));
    return { id: Number(m[1]), type, by: m[3], desc, options, ref: field('근거'), refs, status, done: status.startsWith('완료'), answer: field('답') };
  }).filter(Boolean);
}

// 근거·파일·QR 줄의 board/ 파일 경로들. "board/a/x.md, y.png"의 y.png는 앞 경로 폴더(board/a/)로 푼다.
// shortcut: 절대 경로는 board/ 앞을 잘라 이 저장소 기준으로 본다(다른 저장소의 board/도 같은 이름이면 이쪽 파일로 보임).
const REF = /(?<![\p{L}\p{N}_.\/:-])((?:[\p{L}\p{N}_.@+-]+\/)*[\p{L}\p{N}_.@+-]+\.(?:md|png|jpe?g|gif|webp|svg|mp4|webm|html?))(?![\p{L}\p{N}_\/-])/giu;
export function refPaths(lines) {
  const out = new Set();
  for (const l of lines) {
    let dir = '';
    const v = l.replace(/\\/g, '/').replace(/[a-z]:\/[^,]*?\/(?=board\/)/gi, '');
    for (const [, p] of v.matchAll(REF)) {
      const full = p.includes('/') ? p : dir && dir + p;
      if (p.includes('/')) dir = p.slice(0, p.lastIndexOf('/') + 1);
      if (full && full.startsWith('board/') && !full.split('/').includes('..')) out.add(full);
    }
  }
  return [...out];
}

// Returns the new file text, or throws with a message the dashboard can show.
export function answerTodo(text, id, answer, note, today) {
  const { todo, nth } = findOpen(text, id);
  if (todo.options.length && !todo.options.includes(answer)) throw new Error('보기 중 하나를 골라 주세요');
  if (todo.type === '입력' && !answer.trim() && !note?.trim()) throw new Error('답을 입력해 주세요');
  if (todo.type === '확인' && answer === '추가 지시' && !note?.trim()) throw new Error('추가로 시킬 일을 적어 주세요');
  const full = todo.type === '확인' && answer === '추가 지시' ? `추가 지시: ${note.trim()}` : [answer.trim() || '완료', note?.trim()].filter(Boolean).join(' — ');
  return { text: closeBlock(text, id, nth, full, today), todo, full };
}

// 대표가 TODO를 지운다(스레드 종료·필요 없어짐): 보기 검사 없이 '취소'로 닫고, 다음 실행은 시작하지 않는다.
export function dismissTodo(text, id, why, today) {
  return settleTodo(text, id, `취소 (${why})`, today);
}
// 보기 검사 없이 답(full)을 적어 닫는다
export function settleTodo(text, id, full, today) {
  const { todo, nth } = findOpen(text, id);
  return { text: closeBlock(text, id, nth, full, today), todo };
}

// 같은 번호가 둘일 수 있다(PM 세션과 대시보드가 동시에 다음 번호를 매김): 열린 쪽과, 그게 같은 번호 중 몇 번째(nth)인지
function findOpen(text, id) {
  const same = parseTodos(text).filter((t) => t.id === id), nth = Math.max(0, same.findIndex((t) => !t.done));
  if (!same.length) throw new Error(`T${id}을 찾을 수 없음`);
  if (same[nth].done) throw new Error(`T${id}은 이미 처리됨`);
  return { todo: same[nth], nth };
}

function closeBlock(text, id, nth, full, today) {
  const lines = text.split(/\r?\n/), head = new RegExp(`^### T${id}\\s*·`);
  const start = lines.flatMap((l, i) => (head.test(l) ? [i] : []))[nth];
  let end = lines.findIndex((l, i) => i > start && l.startsWith('### '));
  if (end < 0) end = lines.length;
  const block = lines.slice(start, end).filter((l, i, a) =>
    !l.startsWith('- 상태:') && !l.startsWith('- 답:') && !(l.startsWith('  ') && a.slice(0, i).some((x) => x.startsWith('- 답:'))));
  while (block.length && !block.at(-1).trim()) block.pop();
  const [first, ...rest] = full.split(/\r?\n/);
  block.push(`- 상태: 완료 ${today}`, `- 답: ${first}`, ...rest.map((l) => '  ' + l), '');
  lines.splice(start, end - start, ...block);
  return lines.join('\n');
}

// 끝난 실행의 보고는 대표에게 한 번만 간다. 실행 중에 새로 올라온 미처리 TODO(결정·승인 등)가 있으면 '확인'을 따로 만들지 않고
// 그 TODO들에 '- 보고:' 줄로 붙인다. 없거나 오류로 끝났으면 '확인' TODO 하나. before = 실행을 시작할 때 있던 TODO 번호들.
// 같은 스레드(same(t, todos))에 아직 열린 앞 '확인'은 이 보고(새 확인이든 새 TODO에 붙든)가 이어받으니 닫는다(답: 취소 (새 보고로 바뀜)). 다른 종류는 둔다.
// resolved = 보고가 "처리된 TODO"로 적은 번호: 실행 전부터 있던 열린 TODO만 '스레드에서 처리됨'으로 닫는다. 다른 스레드 것도(대표가 일을 다른 스레드에서 이어 가 처리함, biz-ops T595~597).
// -> { text, ids(보고가 실린 TODO), check(확인을 새로 만들었나), closed(닫은 앞 확인 번호), settled(처리됨으로 닫은 번호) }
export function addRunReport(text, { summary, ref, error, before = [], same, today = '', resolved = [] }) {
  const all0 = parseTodos(String(text));
  const settled = [...new Set(resolved)].filter((id) => before.includes(id) && all0.some((t) => t.id === id && !t.done));
  text = settled.reduce((x, id) => settleTodo(x, id, RESOLVED, today).text, String(text));
  const r = addRunReport0(text, { summary, ref, error, before });
  const all = parseTodos(r.text);
  const old = same ? all.filter((t) => !t.done && t.type === '확인' && !r.ids.includes(t.id) && same(t, all)).map((t) => t.id) : [];
  return { ...r, text: old.reduce((x, id) => dismissTodo(x, id, SUPERSEDED, today).text, r.text), closed: old, settled };
}
function addRunReport0(text, { summary, ref, error, before }) {
  const fresh = error ? [] : parseTodos(String(text)).filter((t) => !t.done && t.type !== '확인' && !before.includes(t.id));
  if (!fresh.length) { const r = addCheckTodo(text, { summary, ref, error }); return { text: r.text, ids: [r.id], check: true }; }
  const nl = /\r\n/.test(text) ? '\r\n' : '\n', lines = String(text).split(/\r?\n/);
  for (const t of fresh) {
    const start = lines.findIndex((l) => new RegExp(`^### T${t.id}\\s*·`).test(l));
    let end = lines.findIndex((l, i) => i > start && l.startsWith('### '));
    if (end < 0) end = lines.length;
    const st = lines.findIndex((l, i) => i > start && i < end && l.startsWith('- 상태:'));
    lines.splice(st >= 0 ? st : end, 0, `- 보고: ${ref}`);
  }
  return { text: lines.join(nl), ids: fresh.map((t) => t.id), check: false };
}

// A finished dashboard run -> one '확인' TODO at the end of todos.md. Numbered from the text passed in, so read the file
// right before calling (other PM sessions append too). report = { summary, ref, error }.
export function addCheckTodo(text, { summary, ref, error }) {
  const id = Math.max(0, ...[...String(text).matchAll(/^### T(\d+)\b/gm)].map((m) => Number(m[1]))) + 1;
  const ls = String(summary || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const one = (ls.find((l) => !l.startsWith('#')) || ls[0] || '').replace(/^#+\s*/, '');   // 제목 줄보다 첫 본문 줄
  const desc = `${error ? '작업이 오류로 끝났습니다. 보고를 확인해 주세요' : '보고를 확인해 주세요'}: ${one.length > 120 ? one.slice(0, 119) + '…' : one || '(내용 없음)'}`;
  const nl = /\r\n/.test(text) ? '\r\n' : '\n';
  const head = String(text || `# 대표 TODO${nl}`).replace(/\s*$/, '');
  return { id, text: [head, '', `### T${id} · 확인 · pm`, desc, `- 근거: ${ref}`, '- 상태: 대기', ''].join(nl) };
}

// 스레드 댓글(open = 그 스레드의 열린 TODO): '확인'만 댓글을 답으로 보고 닫는다. 다른 TODO는 댓글이 답인지 PM이 판단해 보고의 "처리된 TODO" 줄로 닫는다
// (댓글이 전부 닫던 때 1/3이 답이 아니라 PM이 다시 올림, biz-ops 11-25 점검). -> { close: 닫을 확인 번호, note: PM 프롬프트에 덧붙일 글 }
export function byComment(open) {
  const row = (t) => `- T${t.id} [${t.type} · ${t.by}] ${t.desc.split('\n')[0]}${t.type !== '확인' && t.options.length ? ` (보기: ${t.options.join(' / ')})` : ''}`;
  const close = open.filter((t) => t.type === '확인'), wait = open.filter((t) => t.type !== '확인');
  return { close: close.map((t) => t.id),
    note: (close.length ? '\n\n[이 댓글로 닫은 확인 TODO]\n' + close.map(row).join('\n') + '\n위 보고에 대표가 댓글로 이어 말한 것으로 보고 닫았다. 댓글대로 처리해.' : '') +
      (wait.length ? '\n\n[대기 중 TODO]\n' + wait.map(row).join('\n') + '\n위 TODO는 아직 열려 있다. 이 댓글이 그 답이면 댓글대로 처리하고 최종 보고 마지막 줄 "처리된 TODO: T12"에 번호를 적어. 답이 아니면 그대로 둬(열려 있으니 다시 올리지 마).' : '') };
}

// 열린 '확인' 중 보고(근거: board/reports/YYYY-MM-DD-HHMMSS-runN.md, 로컬 시각)가 ms보다 오래된 것의 번호. TODO에는 시각이 없어 보고 파일 이름으로 잰다.
export function staleChecks(todos, now = Date.now(), ms = 24 * 3600e3) {
  return todos.filter((t) => {
    const m = !t.done && t.type === '확인' && t.ref.match(/reports\/(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})(\d{2})/);
    return m && now - new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}`).getTime() > ms;
  }).map((t) => t.id);
}

// What an answered TODO hands to the next PM run: one line, or null when nothing should start ('확인' closed with 종료).
export function followUp(todo, full, ref = todo.ref) {
  if (todo.type === '확인' && !full.startsWith('추가 지시')) return null;
  return `- T${todo.id} [${todo.type} · ${todo.by}] ${todo.desc.split('\n')[0]} → ${full}${todo.type === '확인' && ref ? ` (보고 전문: ${ref})` : ''}`;
}

// TODO attachments land in board/uploads/T<id>/; the paths go into the answer so the PM can read them.
export function uploadPlan(dir, files = []) {
  const used = new Set();
  return files.map((f) => {
    let name = String(f.name || '').split(/[\/]/).pop().replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/^\.+/, '_') || 'file';
    for (let n = 2; used.has(name); n++) name = name.replace(/^(.*?)(-\d+)?(\.[^.]*)?$/, (_, b, _n, ext = '') => `${b}-${n}${ext}`);
    used.add(name);
    return { rel: `board/uploads/${dir}/${name}`, buf: Buffer.from(String(f.data || ''), 'base64') };
  });
}
