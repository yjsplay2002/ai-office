// 대표에게 텔레그램(오피스 전용 봇)으로 글·이미지·파일 보내기.
// node tools/tg-send.mjs "설명" [파일 ...]   — 이미지는 10장씩 앨범, 나머지는 파일로 간다.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { telegramConfig, sendFiles } from './telegram.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [caption = '', ...files] = process.argv.slice(2);
const cfg = telegramConfig(root);
if (!cfg) { console.error('오피스 텔레그램 봇 설정이 없어요 (.office-telegram.env)'); process.exit(1); }
const missing = files.filter((f) => !existsSync(f));
if (missing.length) { console.error('없는 파일:', missing.join(', ')); process.exit(1); }
if (!caption.trim() && !files.length) { console.error('보낼 내용이 없어요'); process.exit(1); }
await sendFiles(cfg, files.map((f) => path.resolve(f)), caption);
console.log(`보냄: ${files.length ? `파일 ${files.length}개` : '메시지'}`);
