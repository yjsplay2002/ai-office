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
    const refs = refPaths(lines.filter((l) => /^- (근거|파일|QR):/.test(l)));
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
  const todo = parseTodos(text).find((t) => t.id === id);
  if (!todo) throw new Error(`T${id}을 찾을 수 없음`);
  if (todo.done) throw new Error(`T${id}은 이미 처리됨`);
  if (todo.options.length && !todo.options.includes(answer)) throw new Error('보기 중 하나를 골라 주세요');
  if (todo.type === '입력' && !answer.trim()) throw new Error('답을 입력해 주세요');
  if (todo.type === '확인' && answer === '추가 지시' && !note?.trim()) throw new Error('추가로 시킬 일을 적어 주세요');
  const full = todo.type === '확인' && answer === '추가 지시' ? `추가 지시: ${note.trim()}` : [answer.trim() || '완료', note?.trim()].filter(Boolean).join(' — ');

  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^### T${id}\\s*·`).test(l));
  let end = lines.findIndex((l, i) => i > start && l.startsWith('### '));
  if (end < 0) end = lines.length;
  const block = lines.slice(start, end).filter((l, i, a) =>
    !l.startsWith('- 상태:') && !l.startsWith('- 답:') && !(l.startsWith('  ') && a.slice(0, i).some((x) => x.startsWith('- 답:'))));
  while (block.length && !block.at(-1).trim()) block.pop();
  const [first, ...rest] = full.split(/\r?\n/);
  block.push(`- 상태: 완료 ${today}`, `- 답: ${first}`, ...rest.map((l) => '  ' + l), '');
  lines.splice(start, end - start, ...block);
  return { text: lines.join('\n'), todo, full };
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
