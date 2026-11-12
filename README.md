# ai-office — 1인 사업용 AI 오피스

PM(메인 세션)이 대표(나)의 목표를 받아 팀원(subagent)에게 일을 나누고, 결과와 대표가 할 일을 `board/`에 쌓는 구성을 프로젝트에 한 번에 차려 주는 Claude Code · Codex 플러그인입니다.

- `/ai-office:init` 한 번으로 인터뷰 → 팀 구성 → 파일 생성.
- 역할마다 **위임 수준**을 고릅니다.
  - AI 전적 위임: 팀원이 끝까지 하고 TODO를 올리지 않음.
  - 일부 위임: 되돌리기 어려운 마지막 버튼 직전까지 하고 `승인` TODO를 올림.
  - 사람만: 팀원 없음. 그 일은 `실행` TODO로 대표에게.
- 대표가 할 일은 `board/todos.md`에 `결정`·`승인`·`입력`·`실행` 네 가지 형식으로 쌓이고, 대시보드에서 버튼으로 답합니다.

## 설치

Claude Code:
```
/plugin marketplace add <owner>/ai-office
/plugin install ai-office@ai-office
```
그다음 차릴 프로젝트 폴더에서 `/ai-office:init`.

Codex:
```
codex plugin marketplace add <owner>/ai-office
codex plugin add ai-office@ai-office
```
그다음 Codex에서 `$ai-office:init`(또는 "AI 오피스 만들어 줘").

로컬 폴더로 써 보기: `<owner>/ai-office` 자리에 이 저장소 경로를 넣습니다.

## init이 만드는 것
| 파일 | 내용 |
|---|---|
| `CLAUDE.md` | PM 규칙 + 팀·위임 수준 표 |
| `AGENTS.md` | Codex용 같은 내용 |
| `.claude/agents/<역할>.md` | 팀원 정의(모델·effort·도구·위임 규칙) |
| `board/todos.md`, `decisions.md`, `log.md`, `board/<역할>/` | 상태 저장소 |
| `.claude/settings.json` | 허용 목록 + `git push` 금지(있으면 병합) |
| `tools/` | 대시보드(골랐을 때) |
| `.claude/ai-office-answers.json` | 인터뷰 답(다시 실행할 때 재사용) |

이미 있는 파일은 묻지 않고 덮어쓰지 않습니다. 다시 실행해도 안전합니다.

## 대시보드 (Claude Code 전용)
```
node tools/office.mjs                                          # http://127.0.0.1:4747 — 지시하면 claude -p 실행(구독 사용량 소모)
node tools/office.mjs --replay tools/fixtures/demo-run.jsonl   # 사용량 0, 예시 실행 재생
```
- 팀원 책상은 `.claude/agents/*.md`에서 자동 배치됩니다.
- **업데이트**: 플러그인을 업데이트하면(`/plugin marketplace update ai-office`), 다음에 대시보드를 켜거나 상단의 `🔄 서버 재시작`을 누를 때 프로젝트의 `tools/`가 새 버전으로 맞춰집니다. 설치된 플러그인 버전이 `tools/.plugin-version`보다 높을 때만 덮어쓰고, `tools/`에 직접 고친 내용이 있으면 그 파일은 새 버전으로 바뀝니다. 이 기능이 들어가기 전(0.1.0)에 init한 프로젝트는 한 번만 `tools/`를 새로 복사하고 서버를 껐다 켜야 합니다.
- 배포하는 쪽: 대시보드를 바꿔 내보낼 때는 `.claude-plugin/plugin.json`(과 `.codex-plugin/plugin.json`)의 `version`을 올려야 사용자에게 전달됩니다.
- 서버는 127.0.0.1에만 열리고, 문서 열람은 `board/` 안 파일만 됩니다.
- 대시보드에서 실행되는 PM은 `--permission-mode bypassPermissions`로 돕니다. 믿을 수 있는 프로젝트에서만 쓰세요.
- 대시보드에서 도는 실행은 `--strict-mcp-config --disable-slash-commands`로 MCP 서버·스킬을 싣지 않습니다(토큰 절약, 권한 우회 실행에 개인 커넥터를 넣지 않기 위해). 그래서 대시보드 경유의 브라우저 담당(`console`)은 Bash로 부르는 CLI 브라우저 도구가 필요합니다. 대화형 Claude Code 세션에서는 평소 MCP·스킬을 그대로 씁니다.
- init이 만드는 `.claude/settings.json`에는 권한 우회 모드가 없습니다. 대화형 세션에서 `dev`·`console`의 Bash 호출은 승인을 물어봅니다.
- 원격으로 열 때 텔레그램 메시지에 넣을 주소는 `.office-telegram.env`에 `OFFICE_URL=https://...` 한 줄을 넣거나 `OFFICE_URL` 환경 변수로 바꿉니다.
- Codex 사용자는 `AGENTS.md`·팀원 정의·`board/`를 그대로 쓰지만, v1의 실시간 대시보드는 `claude -p`만 지원합니다.

## 텔레그램 알림 (선택)
프로젝트 폴더에 `.office-telegram.env`를 만듭니다(`.gitignore`에 포함):
```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```
대시보드가 새 TODO·최종 보고를 이 오피스 전용 봇으로 보내고, 답장으로 TODO에 답하거나 지시를 내릴 수 있습니다. 파일이 없으면 꺼져 있습니다.

## 자체 점검
```
for f in tools/*.test.mjs skills/init/*.test.mjs; do node "$f"; done
```
빌드 단계·npm 의존성 없음. Node 18+.

---

## English

**ai-office** is a Claude Code / Codex plugin that sets up an "AI office" in your project: a PM main session that delegates to persona subagents, and a `board/` folder holding a TODO queue, decision log and work log.

- Run `/ai-office:init` (Claude Code) or `$ai-office:init` (Codex). It interviews you about your business, proposes a team (research, plan, dev, console, marketing, BM, design, or custom roles), and lets you set each role's delegation level (full / partial: approve the final irreversible step / human only) and model (`opus` / `sonnet` / `haiku`, with effort).
- It writes `CLAUDE.md`, `AGENTS.md`, `.claude/agents/*.md`, `board/`, merges `.claude/settings.json` (keeps a `git push` deny), and optionally copies the local dashboard to `tools/`. Existing files are never overwritten without asking.
- Install: `/plugin marketplace add <owner>/ai-office` then `/plugin install ai-office@ai-office`; for Codex, `codex plugin marketplace add <owner>/ai-office` then `codex plugin add ai-office@ai-office`.
- The live 3D dashboard (`node tools/office.mjs`, 127.0.0.1:4747) drives `claude -p` only. After a plugin update, starting the dashboard (or its restart button) syncs the project's `tools/` when the installed plugin version is newer than `tools/.plugin-version`; bump `version` in `.claude-plugin/plugin.json` when releasing. Codex users get the board and agent files, not the dashboard, in v1.
- Templates and prompts are Korean in v1. MIT licensed.
