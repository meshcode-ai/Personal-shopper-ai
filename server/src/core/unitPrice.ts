// 상품명에서 "12개입", "24개입", "320T", "2L 12펫"처럼 개수를 나타내는 패턴을
// 뽑아 단위가(개당 가격)를 계산한다. 실제로는 카탈로그에 정규화된 수량 필드가
// 있어야 정확하지만(같은 상품의 다른 용량/개수 변형을 교차 비교하려면 크롤러가
// 그 변형들을 따로 찾아와야 하는데, 지금 mock 가격 제공자는 그걸 못 한다),
// 지금 가진 데이터(상품명 문자열)만으로 스코프를 좁혀 "이 가격이 개당 얼마인지"
// 부가 정보만 보여준다. 신발 사이즈(41), 모델명(990v6), 와트수(15W) 같은
// 숫자+영문 조합은 아래 단위 키워드 목록에 없는 한 매칭되지 않아 오탐이 적다.
const UNIT_COUNT_PATTERN = /(\d+)\s*(개입|개들이|정|매|캡슐|펫|T)(?![가-힣a-zA-Z])/;

export function parseUnitCount(title: string): number | null {
  const match = title.match(UNIT_COUNT_PATTERN);
  if (!match) return null;
  const count = Number(match[1]);
  return count > 1 ? count : null; // 1개면 "단위가"가 따로 의미 없다
}

export function formatUnitPrice(price: number, title: string): string | null {
  const count = parseUnitCount(title);
  if (!count) return null;
  return `개당 ${Math.round(price / count).toLocaleString()}원`;
}
