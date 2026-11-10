// board/todos.md — 대표가 처리할 일. 형식은 CLAUDE.md의 "대표 TODO" 절 참고.
//
// ### T3 · 결정 · plan
// 가격 정책을 골라 주세요
// - 옵션: $14.99 / $19.99 / 무료+DLC
// - 근거: board/plans/2026-11-05-pricing.md
// - 상태: 대기

export const TYPES = ['결정', '승인', '입력', '실행'];

export function parseTodos(text) {
  return text.split(/^### /m).slice(1).map((part) => {
    const [head, ...lines] = part.split(/\r?\n/);
    const m = head.match(/^T(\d+)\s*·\s*(결정|승인|입력|실행)\s*·\s*(.+?)\s*$/);
    if (!m) return null;
    const field = (k) => (lines.find((l) => l.startsWith(`- ${k}:`)) || '').slice(k.length + 3).trim();
    const type = m[2];
    let options = field('옵션').split(' / ').map((s) => s.trim()).filter(Boolean);
    if (type === '승인' && !options.length) options = ['승인', '반려'];
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
  const full = [answer.trim() || '완료', note?.trim()].filter(Boolean).join(' — ');

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
