// 지출 리포트용 카테고리 분류기. web/app.js의 사이드바 카테고리 필터와 같은
// 취지(제목 키워드 매칭, 스키마 변경 없이 즉시 동작)라 키워드 셋도 맞춰뒀다.
// 프론트 필터와 백엔드 리포트가 완전히 같은 소스를 공유하진 않지만(하나는
// 브라우저 번들, 하나는 서버 모듈), 두 목록이 갈라지면 사용자가 보기에
// "그리드에서는 패션인데 리포트에서는 기타"처럼 헷갈릴 수 있으니 카테고리를
// 늘릴 땐 web/app.js의 CATEGORIES도 같이 갱신할 것.
export interface SpendCategory {
  id: string;
  label: string;
  keywords: string[];
}

export const SPEND_CATEGORIES: SpendCategory[] = [
  { id: "food", label: "식품·생필품", keywords: ["즉석밥", "커피", "생수", "라면", "김치", "우유", "과자", "음료", "시리얼", "견과"] },
  { id: "fashion", label: "패션·잡화", keywords: ["나이키", "뉴발란스", "스투시", "런닝화", "신발", "후드", "티셔츠", "자켓", "가방", "덩크", "패딩"] },
  { id: "beauty", label: "뷰티", keywords: ["샴푸", "에어랩", "트리트먼트", "화장품", "크림", "선크림", "클렌징", "향수", "바디워시"] },
  { id: "electronics", label: "전자기기", keywords: ["충전", "스피커", "이어폰", "케이스", "공기청정기", "드라이기", "블루투스", "아이닉"] },
  { id: "home", label: "홈·리빙", keywords: ["침구", "수납", "조명", "주방", "청소", "가전"] },
];

const ETC_CATEGORY: SpendCategory = { id: "etc", label: "기타", keywords: [] };

export function categorize(itemName: string): SpendCategory {
  for (const category of SPEND_CATEGORIES) {
    if (category.keywords.some((kw) => itemName.includes(kw))) return category;
  }
  return ETC_CATEGORY;
}
