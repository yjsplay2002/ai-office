// /files/<repo path> — 대시보드가 결과물(이미지·동영상·HTML)을 보여 주려고 내주는 파일. 원격으로 열릴 수도 있으므로 좁게 연다.
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';

export const MEDIA_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
};
const DENY = /^(\.env.*|\.office-telegram\.env|\.dev\.vars.*|\.git|node_modules|.*\.(key|pem|jks|keystore))$/i;

// rel = URL-decoded path after /files/. Returns { file, type } for an allowed file inside root, else null.
export function mediaFile(root, rel) {
  if (!rel || rel.includes('\0') || /^[\\/]|^[a-z]:/i.test(rel)) return null;
  if (rel.split(/[\\/]/).some((s) => s === '..' || DENY.test(s))) return null;
  try {
    // realpath on both sides, so a symlink/junction pointing outside the repo is caught.
    const base = realpathSync(root), file = realpathSync(path.resolve(base, rel));
    const rest = path.relative(base, file);
    if (!rest || rest.split(path.sep).some((s) => s === '..' || DENY.test(s)) || path.isAbsolute(rest)) return null;
    const type = MEDIA_TYPES[path.extname(file).toLowerCase()];
    return type && statSync(file).isFile() ? { file, type } : null;
  } catch { return null; }
}

// Range header -> { start, end } (inclusive), null = send whole file, false = 416.
export function byteRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!m || (!m[1] && !m[2])) return null;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return start > end || start >= size ? false : { start, end };
}
