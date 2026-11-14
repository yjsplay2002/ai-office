// TODO 답이 그 TODO가 나온 스레드의 주제를 이어 가는지, 새 주제인지: 작은 모델에게 묻는 글과 그 답 읽기.
// office.mjs가 claude -p로 묻고, 실패하면 원래대로(같은 스레드) 간다.

export function judgePrompt(subject, lines) {
  return `대시보드 스레드 하나의 주제와, 그 스레드에서 나온 TODO에 대표가 단 답들이다. 답마다 이 스레드 주제를 이어 가는 일인지, 새 주제인지 판단해.

[스레드 주제]
${String(subject).slice(0, 1500)}

[답] (형식: TODO 내용 → 대표 답)
${lines.map((l, i) => `${i + 1}. ${String(l).replace(/^- /, '').slice(0, 800)}`).join('\n')}

기준:
- 이어 감: 같은 결과물·같은 목표의 다음 단계(승인, 반려하고 고쳐 달라, 정보 입력, 확인, 같은 일의 추가 지시).
- 새 주제: 스레드 주제와 다른 결과물이나 다른 목표를 시킨다(예: 앱 출시 스레드에서 홍보 계획을 시킴).
- 애매하면 이어 감.

JSON 한 줄로만 답해: {"new":[새 주제인 답 번호],"title":"새 주제들의 짧은 작업 제목(30자 안팎, 새 주제가 없으면 빈 문자열)"}`;
}

// 모델 답 -> { fresh: 새 주제인 답의 0부터 번호, title }. 읽을 수 없으면 null(호출한 쪽이 같은 스레드로 보낸다).
export function parseVerdict(text, n) {
  const m = /\{[\s\S]*\}/.exec(String(text || ''));
  if (!m) return null;
  let v; try { v = JSON.parse(m[0]); } catch { return null; }
  if (!Array.isArray(v.new)) return null;
  const fresh = [...new Set(v.new.map(Number).filter((k) => Number.isInteger(k) && k >= 1 && k <= n))].map((k) => k - 1);
  return { fresh, title: String(v.title || '').trim().slice(0, 60) };
}
