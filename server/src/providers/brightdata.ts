// Bright Data — 공개 가격 데이터(로그인 불필요) 담당.
// BRIGHTDATA_API_TOKEN이 없거나 MOCK_BRIGHTDATA=1이면 mock 결과로 배관을 검증한다.
export interface DealResult {
  found_shop: string;
  found_price: number;
  found_url: string;
  savings_pct: number;
}

export async function findBetterPrice(itemName: string, currentPrice: number): Promise<DealResult> {
  if (process.env.MOCK_BRIGHTDATA === "1" || !process.env.BRIGHTDATA_API_TOKEN) {
    return mockDeal(itemName, currentPrice);
  }
  return callBrightDataSerp(itemName, currentPrice);
}

function mockDeal(itemName: string, currentPrice: number): DealResult {
  // 기준 할인율(15%)에 ±6% 지터를 얹는다 — 매번 완전히 똑같은 값만 나오면
  // 가격 추이 기반 타이밍 조언(core/insights.ts의 generatePriceTimingInsights)이
  // 스냅샷을 여러 번 쌓아도 "항상 최저가"만 반복해서 의미가 없어지기 때문이다.
  // 실제 Bright Data 응답은 어차피 스캔 시점마다 달라지므로 이 쪽이 더 실제와 가깝다.
  const jitter = 1 + (Math.random() - 0.5) * 0.12; // 0.94 ~ 1.06
  const foundPrice = Math.round(currentPrice * 0.85 * jitter);
  return {
    found_shop: "네이버쇼핑",
    found_price: foundPrice,
    found_url: `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(itemName)}`,
    savings_pct: savingsPct(currentPrice, foundPrice),
  };
}

// Bright Data SERP API — Naver 엔진. zone은 계정 대시보드에서 발급받은 값.
// docs: https://docs.brightdata.com/scraping-automation/serp-api
async function callBrightDataSerp(itemName: string, currentPrice: number): Promise<DealResult> {
  const zone = process.env.BRIGHTDATA_SERP_ZONE;
  if (!zone) throw new Error("BRIGHTDATA_SERP_ZONE 미설정");

  const res = await fetch("https://api.brightdata.com/serp/req", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.BRIGHTDATA_API_TOKEN}`,
    },
    body: JSON.stringify({
      zone,
      url: `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(itemName)}`,
      format: "json",
    }),
  });

  if (!res.ok) {
    throw new Error(`Bright Data SERP 오류: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as any;
  // 실제 응답 스키마는 계정별 zone 설정에 따라 다르다 — 실측 후 조정.
  const top = data.organic?.[0] ?? data.results?.[0];
  if (!top) throw new Error("Bright Data 응답에서 상품을 찾지 못함");

  const foundPrice: number = top.price ?? currentPrice;
  return {
    found_shop: "네이버쇼핑",
    found_price: foundPrice,
    found_url: top.link ?? top.url,
    savings_pct: savingsPct(currentPrice, foundPrice),
  };
}

function savingsPct(currentPrice: number, foundPrice: number): number {
  return Math.round(((currentPrice - foundPrice) / currentPrice) * 1000) / 10;
}

// --- 상세페이지 크롤링 (Web Unlocker) ---
// Bright Data(공개 데이터 크롤러)가 1순위. 실패하거나 미설정이면 호출자(core/products.ts)가
// BRIGHTDATA_UNAVAILABLE을 받아 chrome_bridge 수동 제출 경로로 폴백을 안내한다.
export interface CrawledDetail {
  title: string;
  description: string;
  detail_content: string;
  image_url: string | null;
}

export async function fetchProductDetail(url: string): Promise<CrawledDetail> {
  const zone = process.env.BRIGHTDATA_UNLOCKER_ZONE;
  const token = process.env.BRIGHTDATA_API_TOKEN;
  if (!zone || !token) throw new Error("BRIGHTDATA_UNAVAILABLE: BRIGHTDATA_UNLOCKER_ZONE/API_TOKEN 미설정");

  // Web Unlocker API — 로그인 불필요한 공개 URL을 렌더링해 HTML을 돌려준다.
  // docs: https://docs.brightdata.com/scraping-automation/web-unlocker
  let res: Response;
  try {
    res = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ zone, url, format: "raw" }),
    });
  } catch (err) {
    throw new Error(`BRIGHTDATA_UNAVAILABLE: 네트워크 오류 (${(err as Error).message})`);
  }

  if (!res.ok) {
    throw new Error(`BRIGHTDATA_UNAVAILABLE: ${res.status} ${await res.text()}`);
  }

  const html = await res.text();
  // 최소한의 텍스트 추출 — 사이트별 정밀 파서는 필요해지면 shop별로 추가한다.
  // 지금은 <title>과 본문 텍스트를 대충 뽑아 Qwen 태그 추출기에 넘기는 수준으로 충분하다.
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? url;
  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);

  return { title, description: bodyText.slice(0, 200), detail_content: bodyText, image_url: null };
}
