// /files/<repo path> — 대시보드가 결과물(이미지·동영상·HTML)을 보여 주려고 내주는 파일. 원격으로 열릴 수도 있으므로 좁게 연다.
import { realpathSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const MEDIA_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.md': 'text/markdown; charset=utf-8', '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.pdf': 'application/pdf', '.csv': 'text/csv; charset=utf-8',   // 아래는 내려받기만(office.mjs가 attachment로 보냄)
  '.zip': 'application/zip', '.apk': 'application/vnd.android.package-archive', '.aab': 'application/octet-stream', '.ipa': 'application/octet-stream',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const DENY = /^(\.env.*|\.office-telegram\.env|\.office-slack\.env|\.dev\.vars.*|\.git|node_modules|.*\.(key|pem|jks|keystore))$/i;

// rel = URL-decoded path after /files/. Returns { file, type } for an allowed file inside root, else null.
export function mediaFile(root, rel) {
  if (!rel || rel.includes('\0') || /^[\\/]|^[a-z]:/i.test(rel)) return null;
  if (rel.split(/[\\/]/).some((s) => s === '..' || DENY.test(s))) return null;
  try {
    // realpath on both sides, so a symlink/junction pointing outside the repo is caught.
    const base = realpathSync(root), file = realpathSync(path.resolve(base, ...rel.split(/[\\/]/)));   // 맥·리눅스에서도 board\x.png를 찾게
    const rest = path.relative(base, file);
    if (!rest || rest.split(path.sep).some((s) => s === '..' || DENY.test(s)) || path.isAbsolute(rest)) return null;
    const type = MEDIA_TYPES[path.extname(file).toLowerCase()];
    return type && statSync(file).isFile() ? { file, type } : null;
  } catch { return null; }
}

// 글에 board/ 밖 경로로 나온 사진·영상·소리 → 실제 파일 경로들(슬랙에 파일로 올리려고). 팀원이 규칙을 어기고
// 절대 경로(C:\…\Temp\x.png), 저장소나 그 위 폴더 기준 경로(game/shots/x.png, 옆저장소/qa/x.png), 이름만(x.png) 쓰는 경우.
// 이름만 쓴 것은 board/에서 같은 이름의 가장 새 파일. 저장소 밖에서 읽으므로 보고 듣는 형식만, 비밀 이름은 뺀다.
const VIEW = 'png|jpe?g|gif|webp|mp4|webm|mov|mp3|wav|ogg|m4a', SEGC = String.raw`[\p{L}\p{N}_.@+~-]`;
const LOOSE = [
  new RegExp(String.raw`[A-Za-z]:[\\/][^\n\x60'"<>|*?]*?\.(?:${VIEW})(?![A-Za-z0-9_])`, 'giu'),                          // 윈도 절대 경로(빈칸 허용)
  new RegExp(String.raw`(?<![\p{L}\p{N}_.~-])\/(?:${SEGC}+\/)*${SEGC}+\.(?:${VIEW})(?![A-Za-z0-9_])`, 'giu'),            // 맥·리눅스 절대 경로
  new RegExp(String.raw`(?<![\p{L}\p{N}_.\/\\:~@-])(?:${SEGC}+[\\/])*${SEGC}+\.(?:${VIEW})(?![A-Za-z0-9_\/\\])`, 'giu'),   // 상대 경로·이름만
];
export function looseMedia(root, text) {
  const s = String(text ?? ''), out = new Set();
  let names;   // board/ 안 파일 이름 → 가장 새 파일 (처음 필요할 때 한 번 훑음)
  const inBoard = (name) => {
    if (!names) {
      names = new Map();
      const walk = (dir, depth) => { let es = []; try { es = readdirSync(dir, { withFileTypes: true }); } catch {} for (const e of es) {
        if (names.size > 5000 || DENY.test(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory() && depth < 6) walk(p, depth + 1);
        else if (e.isFile()) { const o = names.get(e.name.toLowerCase()); if (!o || statSync(o).mtimeMs < statSync(p).mtimeMs) names.set(e.name.toLowerCase(), p); }
      } };
      walk(path.join(root, 'board'), 0);
    }
    return names.get(name.toLowerCase());
  };
  for (const re of LOOSE) for (const [m] of s.matchAll(re)) {
    const tries = path.isAbsolute(m) ? [m] : /[\\/]/.test(m) ? [path.resolve(root, m), path.resolve(root, '..', m)] : [inBoard(m)];
    for (const f of tries) {
      if (!f || f.split(/[\\/]/).some((x) => DENY.test(x))) continue;
      try { const real = realpathSync(f); if (statSync(real).isFile() && !real.split(/[\\/]/).some((x) => DENY.test(x))) { out.add(real); break; } } catch {}
    }
  }
  return [...out];
}

// Range header -> { start, end } (inclusive), null = send whole file, false = 416.
export function byteRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!m || (!m[1] && !m[2])) return null;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return start > end || start >= size ? false : { start, end };
}
