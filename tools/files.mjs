// /files/<repo path> — 대시보드가 결과물(이미지·동영상·HTML)을 보여 주려고 내주는 파일. 원격으로 열릴 수도 있으므로 좁게 연다.
import { realpathSync, statSync } from 'node:fs';
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

// Range header -> { start, end } (inclusive), null = send whole file, false = 416.
export function byteRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!m || (!m[1] && !m[2])) return null;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return start > end || start >= size ? false : { start, end };
}
