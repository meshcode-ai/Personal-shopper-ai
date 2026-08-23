import type { Database } from "bun:sqlite";
import { listShops } from "./shops";

// 온보딩 넛지 — "쿠팡 쓰신다고요? 그럼 한국 분이실 텐데, 11번가/G마켓/무신사도 자주 쓰지 않으세요?"
// 사용자가 처음 등록한 몰의 도메인으로 나라를 추정하고, 그 나라 사람들이 흔히 같이 쓰는
// 몰 후보를 내려준다. 실제 등록(add_shop)과 chrome_bridge 임포트는 사용자가 "맞다"고
// 확인한 것만 진행해야 한다 — 여기서는 후보 리스트업까지만 하고 절대 자동으로 등록하지 않는다.
export type CountryCode = "KR" | "US" | "CN" | "JP";

// 도메인 → 나라. 등록된 샵들의 base_url 호스트를 이 표로 역추적해 나라를 추정한다.
// 새 나라를 늘릴 땐 이 표와 CANDIDATE_SHOPS를 함께 채울 것.
const DOMAIN_COUNTRY: Record<string, CountryCode> = {
  "coupang.com": "KR",
  "naver.com": "KR",
  "shopping.naver.com": "KR",
  "11st.co.kr": "KR",
  "gmarket.co.kr": "KR",
  "musinsa.com": "KR",
  "kream.co.kr": "KR",
  "oliveyoung.co.kr": "KR",
  "amazon.com": "US",
  "walmart.com": "US",
  "target.com": "US",
  "ebay.com": "US",
  "bestbuy.com": "US",
  "aliexpress.com": "CN",
  "taobao.com": "CN",
  "jd.com": "CN",
  "temu.com": "CN",
  "pinduoduo.com": "CN",
  "amazon.co.jp": "JP",
  "rakuten.co.jp": "JP",
  "mercari.com": "JP",
  "yahoo.co.jp": "JP",
};

export interface ShopCandidate {
  name: string;
  base_url: string;
  order_history_url: string;
  note: string;
}

// 나라별 흔한 몰 후보. 아직 커버 안 되는 나라(예: 동남아, 유럽)는 비워두고, 필요해지면
// DOMAIN_COUNTRY에 도메인 몇 개만 더 추가해도 확장된다.
const CANDIDATE_SHOPS: Record<CountryCode, ShopCandidate[]> = {
  KR: [
    { name: "11번가", base_url: "https://www.11st.co.kr", order_history_url: "https://www.11st.co.kr/MyOrderList", note: "쿠팡 다음으로 흔히 병행 사용" },
    { name: "G마켓", base_url: "https://www.gmarket.co.kr", order_history_url: "https://order.gmarket.co.kr/OrderList", note: "" },
    { name: "무신사", base_url: "https://www.musinsa.com", order_history_url: "https://my.musinsa.com/orders", note: "패션 구매 이력이 많으면 특히 유효" },
    { name: "올리브영", base_url: "https://www.oliveyoung.co.kr", order_history_url: "https://www.oliveyoung.co.kr/store/mypage/getOrderList.do", note: "뷰티 카테고리" },
  ],
  US: [
    { name: "Walmart", base_url: "https://www.walmart.com", order_history_url: "https://www.walmart.com/orders", note: "" },
    { name: "Target", base_url: "https://www.target.com", order_history_url: "https://www.target.com/orders", note: "" },
    { name: "eBay", base_url: "https://www.ebay.com", order_history_url: "https://www.ebay.com/mye/myebay/purchase", note: "" },
    { name: "Best Buy", base_url: "https://www.bestbuy.com", order_history_url: "https://www.bestbuy.com/order-history", note: "전자기기 위주" },
  ],
  CN: [
    { name: "타오바오", base_url: "https://www.taobao.com", order_history_url: "https://buyertrade.taobao.com/trade/itemlist/list_bought_items.htm", note: "국내 IP+로그인 아니면 검색이 잘 안 뜬다 — chrome_bridge로 직접 열어야 확실함" },
    { name: "징동(JD)", base_url: "https://www.jd.com", order_history_url: "https://order.jd.com/center/list.action", note: "" },
    { name: "핀둬둬", base_url: "https://www.pinduoduo.com", order_history_url: "https://mobile.yangkeduo.com/orders.html", note: "" },
  ],
  JP: [
    { name: "라쿠텐", base_url: "https://www.rakuten.co.jp", order_history_url: "https://order.my.rakuten.co.jp/", note: "" },
    { name: "아마존재팬", base_url: "https://www.amazon.co.jp", order_history_url: "https://www.amazon.co.jp/gp/css/order-history", note: "" },
    { name: "메루카리", base_url: "https://jp.mercari.com", order_history_url: "https://jp.mercari.com/mypage/purchases", note: "중고 거래 위주" },
  ],
};

export function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function inferCountryFromDomain(domain: string): CountryCode | null {
  if (DOMAIN_COUNTRY[domain]) return DOMAIN_COUNTRY[domain];
  // 서브도메인(shopping.naver.com 같은) 대비 — 등록된 도메인 표를 접미사로도 한 번 더 맞춰본다.
  for (const [known, country] of Object.entries(DOMAIN_COUNTRY)) {
    if (domain.endsWith(`.${known}`)) return country;
  }
  return null;
}

export interface ShopSuggestions {
  inferred_country: CountryCode | null;
  based_on: string[]; // 나라 추정 근거가 된 등록 샵 이름들
  suggestions: ShopCandidate[];
}

// 등록된 샵들의 도메인으로 나라를 다수결 추정하고, 그 나라의 흔한 몰 후보 중
// 이미 등록된 것(도메인 기준)은 빼고 돌려준다. 자동 등록은 절대 하지 않는다 —
// 실제 계정 보유 여부는 사용자만 알기 때문에, 이 결과는 어디까지나 "물어볼 목록"이다.
export function suggestShops(db: Database): ShopSuggestions {
  const shops = listShops(db);
  const registeredDomains = new Set(shops.map((s) => extractDomain(s.base_url)).filter((d): d is string => d !== null));

  const countryVotes = new Map<CountryCode, string[]>();
  for (const shop of shops) {
    const domain = extractDomain(shop.base_url);
    const country = domain ? inferCountryFromDomain(domain) : null;
    if (!country) continue;
    const names = countryVotes.get(country) ?? [];
    names.push(shop.name);
    countryVotes.set(country, names);
  }

  if (countryVotes.size === 0) {
    return { inferred_country: null, based_on: [], suggestions: [] };
  }

  const [inferredCountry, basedOn] = [...countryVotes.entries()].sort((a, b) => b[1].length - a[1].length)[0];

  const suggestions = (CANDIDATE_SHOPS[inferredCountry] ?? []).filter((candidate) => {
    const domain = extractDomain(candidate.base_url);
    return domain !== null && !registeredDomains.has(domain);
  });

  return { inferred_country: inferredCountry, based_on: basedOn, suggestions };
}
