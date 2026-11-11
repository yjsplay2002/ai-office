# 직원 관리 화면 확인 (2026-11-12)

리플레이 서버(biz-ops 사본, 직원 8명 + PM)에서 확인했다.

- `staff-page.png`: 👥 직원 관리를 연 화면. 카드마다 3D 인물 얼굴(작은 렌더러로 한 번만 그림), 역할·이름·설명·모델·노력 수준·토큰.
- `renamed-label.png`: dev의 이름을 빌드 → 망치, 모델 opus → sonnet, 노력 high → xhigh로 저장한 뒤. 오피스 이름표가 "개발 망치"로 바로 바뀜.
- 파일 변화: `.claude/agents/dev.md`의 description의 「…」, model, effort 세 줄만 바뀜(나머지 바이트 그대로).
- 거부 확인: 모델 `gpt-5` → 400, 없는 직원 `../../x` → 400, 13자 이름 → 400.
- PM: `.claude/ai-office.json`에 저장, 실행 때 `--model`/`--effort`로 넘김(`tools/staff.test.mjs`).
- 콘솔 오류 0. `node tools/*.test.mjs` 모두 통과.
