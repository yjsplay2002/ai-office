// /ai-office:init 의 마지막 단계: 인터뷰 답(JSON)을 받아 현재 프로젝트에 오피스 파일을 만든다.
// node scaffold.mjs <answers.json> [--target <dir>] [--overwrite CLAUDE.md,AGENTS.md,...]
// 이미 있는 파일은 건드리지 않고 "건너뜀"으로 알린다(--overwrite에 적은 것만 덮어쓴다). settings.json은 병합한다.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tpl = path.join(here, 'templates');
const pluginTools = path.resolve(here, '..', '..', 'tools');

const LEVELS = { full: 'AI 전적 위임', partial: '일부 위임', human: '사람만' };
const MODELS = ['opus', 'sonnet', 'haiku', 'inherit'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const DEFAULT_TOOLS = 'Read, Write, Edit, Glob, Grep, WebSearch, WebFetch';

const DELEGATION = {
  full: `## 위임 수준: AI 전적 위임
대표가 이 역할을 AI에게 전적으로 맡겼다. 맡은 일은 마지막 버튼(제출·게시·발송)까지 직접 끝내고 TODO를 올리지 않는다.
결제·카드 입력, 계약·서명, 본인 확인·비밀번호·2단계 인증처럼 사람만 할 수 있는 단계만 \`board/todos.md\`에 \`실행\` TODO로 올린다.`,
  partial: `## 위임 수준: 일부 위임
되돌리기 어려운 마지막 버튼(제출·게시·발송·결제·출시) 직전까지 모두 해 두고 멈춘다.
\`board/todos.md\`에 \`승인\` TODO("제출할까요?")를 CLAUDE.md 형식대로 올리고, 승인되면 그때 누른다.
사람만 할 수 있는 단계(결제·서명·본인 확인·로그인)는 \`실행\` TODO로 올린다.`,
};

export function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: text };
  const fm = Object.fromEntries(m[1].split(/\r?\n/).map((l) => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map((x) => [x[1], x[2].trim()]));
  return { fm, body: m[2] };
}

// Validates the interview answers; throws with a message the skill can show to the user.
export function normalize(a) {
  if (!a || typeof a !== 'object') throw new Error('답 JSON이 객체가 아님');
  const roles = (a.roles || []).map((r) => {
    if (!/^[a-z][a-z0-9-]{0,30}$/.test(r.name || '')) throw new Error(`역할 이름은 영문 소문자·숫자·-만: ${r.name}`);
    if (!LEVELS[r.level]) throw new Error(`${r.name}: level은 full | partial | human`);
    const t = existsSync(path.join(tpl, 'roles', r.name + '.md')) ? frontmatter(readFileSync(path.join(tpl, 'roles', r.name + '.md'), 'utf8')) : null;
    const model = r.model || t?.fm.model || 'sonnet', effort = r.effort || t?.fm.effort || 'medium';
    if (!MODELS.includes(model)) throw new Error(`${r.name}: model은 ${MODELS.join(' | ')}`);
    if (!EFFORTS.includes(effort)) throw new Error(`${r.name}: effort는 ${EFFORTS.join(' | ')}`);
    const description = (r.description || t?.fm.description || '').replace(/\s+/g, ' ').trim();
    if (!description) throw new Error(`${r.name}: 템플릿에 없는 역할은 description이 필요`);
    // frontmatter에 따옴표 없이 들어가고 대시보드가 그 줄을 그대로 읽으므로 YAML을 깨는 글자는 받지 않는다.
    if (/: | #|^[[{>|*&!%@`'"-]/.test(description)) throw new Error(`${r.name}: description에 ": ", " #" 또는 맨 앞 특수문자는 쓸 수 없음`);
    return { name: r.name, level: r.level, model, effort, description, title: description.split('.')[0],
      tools: r.tools || t?.fm.tools || DEFAULT_TOOLS, body: (t?.body.trim() || `너는 ${description.split('.')[0]} 담당이다. 결과는 \`board/${r.name}/YYYY-MM-DD-<주제>.md\`에 쓴다.`) + (r.body ? `\n\n${r.body.trim()}` : '') };
  });
  if (new Set(roles.map((r) => r.name)).size !== roles.length) throw new Error('역할 이름이 겹침');
  return { business: String(a.business || '').trim() || '(미정)', areas: [].concat(a.areas || []).join(', ') || '(미정)', roles, telegram: !!a.telegram, dashboard: a.dashboard !== false };
}

export function agentFile(r) {
  return `---\nname: ${r.name}\ndescription: ${r.description}\ntools: ${r.tools}\nmodel: ${r.model}\neffort: ${r.effort}\n---\n\n${r.body}\n\n${DELEGATION[r.level]}\n`;
}

export function pmFile(c) {
  const rows = c.roles.map((r) => `| \`${r.level === 'human' ? '대표' : r.name}\` | ${r.title} | ${LEVELS[r.level]} | ${r.level === 'human' ? '—' : `${r.model} / ${r.effort}`} |`);
  const table = ['| 담당 | 하는 일 | 위임 수준 | 모델 / effort |', '|---|---|---|---|', ...rows].join('\n');
  const telegram = c.telegram ? '- 대표와의 텔레그램 채널은 오피스 전용 봇 하나뿐이다(`.office-telegram.env`). 텔레그램 플러그인 도구는 쓰지 않는다. 대표가 이미지·파일을 텔레그램으로 달라고 하면 `node tools/tg-send.mjs "설명" 파일1 파일2 …`로 보낸다(이미지는 10장씩 앨범). 새 TODO와 최종 보고는 대시보드 서버가 알아서 보낸다.' : '';
  const dash = c.dashboard ? '\n## 대시보드\n`node tools/office.mjs` → http://127.0.0.1:4747 . 대시보드에서 내린 지시와 TODO 답은 각각 `claude -p` PM 세션으로 바로 시작된다. 팀원 책상은 `.claude/agents/*.md`에서 자동으로 배치된다.\n' : '';
  return readFileSync(path.join(tpl, 'CLAUDE.md'), 'utf8')
    .replace('{{BUSINESS}}', () => c.business).replace('{{AREAS}}', () => c.areas).replace('{{ROLES}}', () => table)
    .replace('{{TELEGRAM}}\n', () => (telegram ? telegram + '\n' : '')).replace('{{DASHBOARD}}\n', () => dash);
}

const AGENTS_HEAD = `<!-- /ai-office:init 이 CLAUDE.md와 같은 내용으로 만든 Codex용 사본. 규칙을 바꾸면 두 파일을 같이 고친다. -->
> Codex에서: 팀원 지시서는 \`.claude/agents/<역할>.md\`다. 하위 에이전트를 띄울 수 있으면 그 파일 본문을 지시로 넘기고, 없으면 그 역할의 규칙과 위임 수준대로 직접 한다. 실시간 대시보드(\`tools/office.mjs\`)는 Claude Code(\`claude -p\`) 전용이다.

`;

export function mergeSettings(cur, add) {
  const out = { ...cur, permissions: { ...(cur.permissions || {}) } };
  for (const k of ['allow', 'deny']) out.permissions[k] = [...new Set([...(cur.permissions?.[k] || []), ...(add.permissions[k] || [])])];
  return out;
}

export function scaffold(answers, target, overwrite = []) {
  const c = normalize(answers);
  const log = [];
  const put = (rel, text) => {
    const p = path.join(target, rel);
    const existed = existsSync(p);
    if (existed && !overwrite.includes(rel)) return log.push(`건너뜀(이미 있음) ${rel}`);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
    log.push(`${existed ? '덮어씀' : '생성'} ${rel}`);
  };
  const pm = pmFile(c);
  put('CLAUDE.md', pm);
  put('AGENTS.md', AGENTS_HEAD + pm);
  for (const r of c.roles) if (r.level !== 'human') put(`.claude/agents/${r.name}.md`, agentFile(r));
  for (const f of ['todos.md', 'decisions.md', 'log.md']) put(`board/${f}`, readFileSync(path.join(tpl, 'board', f), 'utf8'));
  for (const r of c.roles) if (r.level !== 'human') put(`board/${r.name}/.gitkeep`, '');
  if (c.roles.some((r) => r.name === 'dev' && r.level !== 'human')) put('board/dev/backlog.md', '# 개발 백로그\n\n한 줄에 하나: `- [출처] <기능> — 근거: board/<파일>`\n');

  // settings.json: allow·deny는 합집합, 그 밖의 키는 사용자 것을 그대로 둔다. git push 금지는 항상 남는다.
  const add = JSON.parse(readFileSync(path.join(tpl, 'settings.json'), 'utf8'));
  if (c.telegram) add.permissions.allow.push('Bash(node tools/tg-send.mjs:*)');
  const sp = path.join(target, '.claude', 'settings.json');
  if (existsSync(sp)) {
    let cur;
    try { cur = JSON.parse(readFileSync(sp, 'utf8')); } catch { throw new Error('.claude/settings.json이 올바른 JSON이 아니어서 병합하지 않음. 고친 뒤 다시 실행'); }
    const merged = mergeSettings(cur, add);
    if (JSON.stringify(merged) === JSON.stringify(cur)) log.push('그대로 .claude/settings.json');
    else { writeFileSync(sp, JSON.stringify(merged, null, 2) + '\n'); log.push('병합 .claude/settings.json'); }
  } else put('.claude/settings.json', JSON.stringify(add, null, 2) + '\n');

  if (c.dashboard || c.telegram) {
    const copy = (rel) => {
      const src = path.join(pluginTools, rel);
      if (statSync(src).isDirectory()) return readdirSync(src).forEach((f) => copy(path.join(rel, f)));
      put(path.join('tools', rel).replace(/\\/g, '/'), readFileSync(src));
    };
    copy('');
    // 대시보드가 플러그인 업데이트를 알아보는 기준(tools/update.mjs): 이 tools/를 받은 플러그인 버전
    put('tools/.plugin-version', JSON.parse(readFileSync(path.resolve(here, '..', '..', '.claude-plugin', 'plugin.json'), 'utf8')).version + '\n');
  }
  const gi = path.join(target, '.gitignore'), want = ['.office-runs/', '.office-telegram.env'];
  const have = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  const miss = want.filter((w) => !have.split(/\r?\n/).includes(w));
  if (miss.length) { writeFileSync(gi, have + (have && !have.endsWith('\n') ? '\n' : '') + miss.join('\n') + '\n'); log.push(`추가 .gitignore: ${miss.join(' ')}`); }
  return log;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const file = process.argv[2];
  if (!file || file.startsWith('--')) { console.error('사용법: node scaffold.mjs <answers.json> [--target <dir>] [--overwrite a,b]'); process.exit(1); }
  try {
    const log = scaffold(JSON.parse(readFileSync(file, 'utf8')), path.resolve(arg('--target') || '.'), (arg('--overwrite') || '').split(',').filter(Boolean));
    console.log(log.join('\n'));
  } catch (e) { console.error('오류:', e.message); process.exit(1); }
}
