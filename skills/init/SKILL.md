---
name: init
description: >
  AI 오피스를 현재 프로젝트에 차린다. 대표(사용자)를 인터뷰해 사업·팀 역할·역할별 위임 수준·모델을 정하고,
  PM 규칙(CLAUDE.md·AGENTS.md), 팀원(.claude/agents), board/(TODO·결정·로그), 권한 설정, 대시보드를 만든다.
  "/ai-office:init", "AI 오피스 만들어", "AI 팀 세팅", "set up ai office" 요청에 사용.
---

# AI 오피스 init

이 스킬은 메인 세션에서 직접 돈다(하위 에이전트에 넘기지 않는다). 대표와 대화하며 답을 모으고, 마지막에 `scaffold.mjs` 하나로 파일을 만든다.

질문하는 법:
- **Claude Code**: `AskUserQuestion` 도구를 쓴다(한 번에 질문 최대 4개, 질문마다 보기 2~4개, "기타" 칸은 자동으로 붙는다).
- **Codex 등 그 도구가 없는 곳**: 같은 질문을 번호 붙은 보기와 함께 평문으로 묻고 답을 기다린다.
- 한국어로 묻는다. 대표가 영어로 답하면 영어로 이어 간다(파일 템플릿은 한국어 그대로).

## 0. 이미 차려진 오피스인지 확인
- `.claude/ai-office-answers.json`이 있으면 지난 답을 요약해 보여 주고 "지난 답으로 다시 만들기 / 고쳐서 다시 만들기 / 처음부터"를 묻는다. 다시 만들어도 이미 있는 파일은 덮어쓰지 않는다.
- `CLAUDE.md`·`AGENTS.md`·`.claude/agents/`가 이미 있으면 그 사실을 미리 알린다.

## 1. 사업
두 가지를 묻는다(자유 답).
- 무엇을 하는지 한 줄로. (예: "1인 모바일 앱 개발사", "온라인 꽃 배달 쇼핑몰")
- 주요 업무 영역. (예: 조사, 기획, 개발, 마케팅, 고객 응대, 디자인)

## 2. 팀 제안
답을 보고 아래 템플릿에서 팀을 고른다. 템플릿에 없는 일(고객 응대, 회계 정리, 콘텐츠 제작 등)은 새 역할로 만든다(이름은 영문 소문자, 예: `cs`, `content`).

| 이름 | 하는 일 | 추천 모델 / effort |
|---|---|---|
| `research` | 시장·경쟁·고객 반응 조사 | sonnet / medium |
| `plan` | 타겟·가격·로드맵 선택지 | opus / high |
| `dev` | 개발·빌드·배포 | opus / high |
| `console` | 웹 콘솔·관리 화면 브라우저 조작 | sonnet / medium |
| `marketing` | 홍보 전략·게시글 초안 | sonnet / high |
| `bm` | 수익모델 설계 | sonnet / high |
| `design` | UI·레이아웃·비주얼 | opus / high |

모델 추천 기준: 무거운 코딩·설계 → `opus` / `high`, 조사·브라우저 조작·글쓰기 → `sonnet` / `medium`, 가벼운 정리·분류·응대 → `haiku` / `low`. 모델은 별칭(`opus`·`sonnet`·`haiku`)만 쓴다. 모델 ID를 적지 않는다.

## 3. 위임 수준
역할마다 하나를 정한다. 업무 성격으로 먼저 추천한다: 내부 작업(조사·기획·초안)은 전적 위임, 밖으로 나가는 일(배포·게시·제출·발송)이 있는 역할은 일부 위임, 법무·세무·계약처럼 사람이 책임지는 일은 사람만.

| 위임 수준 | `level` | 동작 |
|---|---|---|
| AI 전적 위임 | `full` | 팀원이 끝까지 하고 TODO를 올리지 않는다(결제·서명·본인 확인만 `실행` TODO). |
| 일부 위임 | `partial` | 되돌리기 어려운 마지막 버튼 직전까지 하고 `승인` TODO를 올린다. 승인되면 팀원이 누른다. |
| 사람만 | `human` | 팀원을 만들지 않는다. 그 일은 `실행` TODO로 대표에게 간다. |

2·3·4단계는 역할마다 따로 묻지 않는다. **표 하나로 한 번에 제안**하고 고칠 것만 받는다:

```
| 역할 | 하는 일 | 위임 수준 | 모델 / effort |
| research | 시장·경쟁 조사 | AI 전적 위임 | sonnet / medium |
| dev | 개발·배포 | 일부 위임 | opus / high |
...
```
그다음 질문: "이대로 갈까요?" 보기: `이대로` / `역할 추가·삭제` / `위임 수준 바꾸기` / `모델 바꾸기`. 고친 표를 다시 보여 주고 `이대로`가 나올 때까지 반복한다.

## 4. 옵션
한 번에 묻는다(Claude Code는 질문 2개짜리 `AskUserQuestion` 한 번).
- 텔레그램 알림: `안 씀`(기본) / `씀` — 쓰면 새 TODO·최종 보고가 오피스 전용 봇으로 간다. 토큰은 나중에 대표가 `.office-telegram.env`에 직접 넣는다(이 대화에 토큰을 붙여 넣지 말라고 안내한다).
- 대시보드: `씀`(기본) / `안 씀` — `node tools/office.mjs`로 여는 3D 오피스. Claude Code(`claude -p`) 전용이다.

## 5. 파일 만들기
1. 답을 `.claude/ai-office-answers.json`에 쓴다:
   ```json
   {
     "business": "한 줄 설명",
     "areas": ["조사", "개발"],
     "roles": [
       { "name": "research", "level": "full", "model": "sonnet", "effort": "medium" },
       { "name": "dev", "level": "partial", "model": "opus", "effort": "high" },
       { "name": "cs", "level": "partial", "model": "haiku", "effort": "low",
         "description": "고객 응대 「창구」. 문의 메일에 답장 초안을 쓰고 보낸다. \"문의\", \"CS\" 요청에 사용.",
         "body": "- 답장은 board/cs/에 초안으로 먼저 쓴다." },
       { "name": "legal", "level": "human", "description": "법무 검토. 계약서와 약관을 본다." }
     ],
     "telegram": false,
     "dashboard": true
   }
   ```
   - 템플릿 역할(`research`·`plan`·`dev`·`console`·`marketing`·`bm`·`design`)은 `name`·`level`만 있어도 된다.
   - 새 역할은 `description`이 필요하다. 첫 문장은 짧은 직함(대시보드 책상 이름이 된다), 이어서 하는 일과 "~ 요청에 사용."을 쓴다. `body`(지시 몇 줄)와 `tools`는 선택.
   - `effort`: `low` | `medium` | `high` | `xhigh` | `max`.
2. 실행한다(현재 프로젝트 폴더에서):
   - Claude Code: `node "${CLAUDE_PLUGIN_ROOT}/skills/init/scaffold.mjs" .claude/ai-office-answers.json`
   - 그 변수가 비어 있거나 Codex라면: 이 SKILL.md가 있는 폴더의 `scaffold.mjs`를 같은 인자로 실행한다.
3. 출력에 `건너뜀(이미 있음)`이 있으면 그 파일 목록을 보여 주고 덮어쓸지 하나씩 묻는다. 덮어쓰기로 한 것만 `--overwrite CLAUDE.md,AGENTS.md`처럼 붙여 다시 실행한다. 묻지 않고 덮어쓰지 않는다. 기존 `CLAUDE.md`를 지키고 싶다고 하면, 새 PM 규칙을 그 파일 끝에 붙일지 물어보고 붙이기로 하면 직접 붙인다.
4. `오류:`가 나오면 그 메시지대로 답을 고쳐 다시 실행한다.

## 6. 마무리 안내
짧게 알려 준다:
- 만든 파일 목록(스크립트 출력 그대로).
- 시작하는 법: Claude Code를 이 폴더에서 새로 열고 목표를 말하면 PM이 팀원에게 나눈다. 대표 할 일은 `board/todos.md`에 쌓인다.
- 대시보드를 골랐으면: `node tools/office.mjs` → http://127.0.0.1:4747 (지시하면 `claude -p`가 돌아 구독 사용량을 쓴다). 써 보기만 하려면 `node tools/office.mjs --replay tools/fixtures/demo-run.jsonl`.
- 텔레그램을 골랐으면: 프로젝트 폴더에 `.office-telegram.env`를 만들고 `TELEGRAM_BOT_TOKEN=...`, `TELEGRAM_CHAT_ID=...` 두 줄을 넣는다(`.gitignore`에 이미 들어 있다).
- Codex: `AGENTS.md`와 `board/`는 그대로 쓰고, 대시보드는 v1에서 Claude Code 전용이다.
- 아직 커밋하지 않았다. 원하면 `git add`할 파일을 골라 커밋하자고 제안한다(푸시는 하지 않는다).
