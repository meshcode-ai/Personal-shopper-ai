// 해외직구 비교 대상 글로벌 쇼핑몰 레퍼런스. 미국/중국 위주로 정리했다.
//
// scrape_path는 실측(mc__meshcode__chrome_bridge로 각 검색 URL을 직접 열어본 결과) 기준:
//   - "public"      : 로그인 없이 검색 결과가 그대로 나온다. 공개 가격 검색/Web Unlocker
//                      API 같은 서버사이드 프록시로 스케일 가능 (priceSearch.ts와 같은 패턴).
//   - "login_wall"  : 검색 결과 자체가 로그인/가입을 요구한다. 서버가 직접 fetch()해서는
//                      못 뚫는다 — chrome_bridge로 사용자의 실제 로그인 세션을 빌리는
//                      데스크톱 에이전트 경로만 통한다 (README의 "로그인 필요 페이지" 케이스와 동일).
//                      로그인이 안 돼 있어도 포기하지 않는다: chrome_bridge가 눈에 보이는
//                      크롬이니 사용자에게 "로그인해주세요" 넛지를 띄우고 handoff로 조작권을
//                      넘긴 뒤, 로그인 완료되면 takeover로 되찾아와 이어서 읽으면 된다.
//   - "app_only"    : 웹 검색 자체가 앱/모바일 전용이거나 지역 제한이 심해 URL 패턴이
//                      불안정하다 (예: 중국 본토 도메인이 해외 IP로 접속 시 다른 화면을 보여줌).
//
// 즉 "public"인 몰은 공개 가격 API로 서버가 직접 긁어서 findBetterPrice류 자동 스캔에 넣을 수
// 있고, "login_wall"/"app_only"인 몰은 chrome_bridge로 사용자가 직접 열어야 값이 나온다 —
// 하나의 스크레이퍼로 다 통일할 수 없다는 뜻이라 몰마다 이 필드를 꼭 확인하고 붙일 것.
export interface GlobalMall {
  id: string;
  name: string;
  country: "US" | "CN" | "JP";
  currency: string;
  search_url: (query: string) => string;
  scrape_path: "public" | "login_wall" | "app_only";
  note: string;
}

export const GLOBAL_MALLS: GlobalMall[] = [
  {
    id: "amazon",
    name: "Amazon.com",
    country: "US",
    currency: "USD",
    search_url: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
    scrape_path: "public",
    note: "로그인 없이 검색 결과 노출. 배송지가 한국이면 가격이 KRW로 환산돼 나온다 — 실제 결제 통화(USD)는 상품 상세에서 별도 확인 필요.",
  },
  {
    id: "walmart",
    name: "Walmart",
    country: "US",
    currency: "USD",
    search_url: (q) => `https://www.walmart.com/search?q=${encodeURIComponent(q)}`,
    scrape_path: "public",
    note: "로그인 없이 검색 결과 노출, USD 정가. 해외 배송 가능 여부는 상품별로 다르므로 배송비 확인 필수.",
  },
  {
    id: "aliexpress",
    name: "AliExpress",
    country: "CN",
    currency: "KRW",
    search_url: (q) => `https://ko.aliexpress.com/w/wholesale-${encodeURIComponent(q.replace(/\s+/g, "-"))}.html`,
    scrape_path: "public",
    note: "로그인 없이 검색 결과 노출, 한국 로케일이면 ₩로 바로 환산돼 나와 별도 환율 계산이 필요 없다. 현재 overseas.ts의 mock 추정치가 대체할 1순위 후보.",
  },
  {
    id: "temu",
    name: "Temu",
    country: "CN",
    currency: "KRW",
    search_url: (q) => `https://www.temu.com/search_result.html?search_key=${encodeURIComponent(q)}`,
    scrape_path: "login_wall",
    note: "검색 결과 페이지 자체가 로그인/가입 화면으로 리다이렉트된다. 공개 가격 API로 못 뚫으면 chrome_bridge로 열어 로그인 넛지 → handoff/takeover 경로만 남는다.",
  },
  {
    id: "taobao",
    name: "타오바오(淘宝)",
    country: "CN",
    currency: "CNY",
    search_url: (q) => `https://s.taobao.com/search?q=${encodeURIComponent(q)}`,
    scrape_path: "app_only",
    note: "해외 IP/비로그인으로 열면 world.taobao.com(해외 전용 큐레이션 홈)으로 튕기고 검색 결과 대신 추천 상품만 보여준다. 실질적으로 국내 IP+로그인 없인 검색 자체가 안 됨 — 자동 스캔 대상에서 제외하는 게 현실적.",
  },
];
