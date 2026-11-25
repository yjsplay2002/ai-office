// node tools/look.mjs a.png [b.png …] "질문" — 화면 사진을 작은 모델(haiku)에게 보여 주고 글 답만 stdout으로 낸다.
// 팀원이 PNG를 Read로 직접 열면 이미지가 그 세션 문맥에 계속 남아 매 턴 토큰을 먹는다. 이 도구는 별도 짧은 세션에서 보고 글만 돌려준다.
// 여러 장이면 한 번에 묻는다. 실패하면 이유 한 줄을 stderr에 쓰고 1로 끝난다.
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const MAX = 3.7e6;   // API 한 장 한도 5MB(base64 기준) 아래로

// args -> { files, question } 또는 throw. 마지막 인자가 그림 파일이 아니면 질문.
export function parseArgs(args) {
  const last = args.at(-1), q = last && !TYPES[path.extname(last).toLowerCase()];
  const files = q ? args.slice(0, -1) : args, question = (q ? last : '').trim() || '이 화면에 무엇이 보이는지, 깨지거나 이상한 곳이 있는지 짧게 알려 줘.';
  if (!files.length) throw new Error('사용법: node tools/look.mjs <그림...> "질문"');
  for (const f of files) {
    if (!TYPES[path.extname(f).toLowerCase()]) throw new Error(`그림 파일이 아님: ${f}`);
    if (!existsSync(f)) throw new Error(`파일 없음: ${f}`);
    if (statSync(f).size > MAX) throw new Error(`너무 큼(3.7MB 넘음): ${f} — 창 크기를 줄여 다시 찍거나 jpeg로`);
  }
  return { files, question };
}

// stream-json 입력 한 줄: 그림들 + 질문(그림 번호는 넘긴 순서)
export function userMessage(files, question, read = readFileSync) {
  const content = files.flatMap((f, i) => [
    ...(files.length > 1 ? [{ type: 'text', text: `그림 ${i + 1}: ${path.basename(f)}` }] : []),
    { type: 'image', source: { type: 'base64', media_type: TYPES[path.extname(f).toLowerCase()], data: read(f).toString('base64') } },
  ]);
  content.push({ type: 'text', text: `${question}\n\n글로만 짧게 답해(5줄 안쪽). 보이지 않는 것은 추측하지 말고 "안 보임"이라고 해.` });
  return JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n';
}

function ask(files, question) {
  return new Promise((resolve, reject) => {
    const cwd = path.join(os.tmpdir(), 'office-look');   // 프로젝트 CLAUDE.md를 싣지 않게 빈 폴더에서(늘 같은 폴더: ~/.claude/projects에 폴더가 쌓이지 않게)
    mkdirSync(cwd, { recursive: true });
    // shell(윈도 claude.cmd)은 빈 인자를 지우니 '""'로 넘긴다
    const c = spawn('claude', ['-p', '--model', 'haiku', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--tools', process.platform === 'win32' ? '""' : '', '--no-session-persistence', '--setting-sources', 'project'],
      { cwd, shell: process.platform === 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (err += d));
    c.on('error', (e) => reject(new Error(`claude 실행 실패: ${e.message}`)));
    c.on('close', (code) => {
      const r = out.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).findLast((o) => o?.type === 'result');
      if (r && !r.is_error && r.result) return resolve(String(r.result).trim());
      reject(new Error(r?.result || err.trim().split('\n').at(-1) || `claude가 답 없이 끝남(코드 ${code})`));
    });
    c.stdin.on('error', () => {});
    c.stdin.end(userMessage(files, question));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const { files, question } = parseArgs(process.argv.slice(2));
    console.log(await ask(files, question));
  } catch (e) {
    console.error('look 실패: ' + String(e.message).split('\n')[0]);
    process.exit(1);
  }
}
