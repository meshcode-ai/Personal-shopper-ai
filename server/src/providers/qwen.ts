// Qwen Cloud (Alibaba Cloud Model Studio, OpenAI 호환 엔드포인트) — 취향 추론 두뇌.
// DASHSCOPE_API_KEY가 없거나 MOCK_LLM=1이면 네트워크 없이도 배관을 검증할 수 있는
// 결정적 규칙 기반 폴백으로 동작한다 (스모크테스트 / 오프라인 데모용).
export interface PurchaseForAnalysis {
  item_name: string;
  price: number;
  quantity: number;
  bought_at: string | null;
}

export interface InterestTag {
  tag: string;
  score: number;
  evidence: string;
}

export interface AnalysisResult {
  interests: InterestTag[];
  profileMarkdown: string;
}

export interface ShoppingChatContext {
  profileMarkdown: string;
  purchases: Array<{ item_name: string; price: number; shop_name: string; bought_at: string | null }>;
  deals: Array<{ item_name: string; found_shop: string; found_price: number; savings_pct: number }>;
}

export interface ShoppingChatResult {
  message: string;
  mode: "qwen" | "mock";
}

// 채팅은 서버에서만 Qwen을 호출한다. 브라우저에는 API 키·구매 원문·토큰을 절대 전달하지 않는다.
export async function chatWithPersonalShopper(
  message: string,
  context: ShoppingChatContext,
): Promise<ShoppingChatResult> {
  if (process.env.MOCK_LLM === "1" || !process.env.DASHSCOPE_API_KEY) {
    const bestDeal = context.deals[0];
    const dealHint = bestDeal
      ? `지금은 ${bestDeal.item_name}을 ${bestDeal.found_shop}에서 ${bestDeal.found_price.toLocaleString()}원(${bestDeal.savings_pct}% 절약)으로 볼 수 있어요.`
      : "먼저 구매내역을 동기화하거나 ‘최저가 찾기’를 눌러 비교 데이터를 채워보세요.";
    return {
      mode: "mock",
      message: `${dealHint} “${message}”에 맞춰 관심 상품을 한국어 검색어로 정리하고, 등록된 쇼핑몰과 공개 가격 데이터를 비교해드릴게요.`,
    };
  }

  const baseUrl = process.env.QWEN_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
  const model = process.env.QWEN_MODEL ?? "qwen3-max";
  const system = `너는 한국어 퍼스널 쇼핑 AI다. 사용자의 구매 기록과 취향 프로필을 바탕으로 쇼핑을 돕는다.
답변은 친절하고 짧은 한국어로 쓴다. 해외/글로벌 쇼핑몰 상품명은 자연스러운 한국어 검색어와 함께 설명한다.
제공된 딜 데이터에 없는 현재 가격·재고·할인율을 지어내지 마라. 개인 구매기록·자격증명·API 키는 요약해도 노출하지 마라.
사용자가 관심 상품을 찾으면 취향 근거, 비교할 쇼핑몰/검색어, 다음 행동을 제안한다.`;
  const user = JSON.stringify({
    question: message,
    profile: context.profileMarkdown.slice(0, 6000),
    recentPurchases: context.purchases.slice(0, 20),
    betterPriceDeals: context.deals.slice(0, 10),
  });

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Qwen API 오류: ${res.status}`);
  const data = (await res.json()) as any;
  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error("Qwen 응답에 content가 없음");
  return { message: reply, mode: "qwen" };
}

export async function analyzeInterests(
  purchases: PurchaseForAnalysis[],
  previousProfileMd: string,
): Promise<AnalysisResult> {
  if (process.env.MOCK_LLM === "1" || !process.env.DASHSCOPE_API_KEY) {
    return mockAnalyze(purchases);
  }
  return callQwen(purchases, previousProfileMd);
}

function mockAnalyze(purchases: PurchaseForAnalysis[]): AnalysisResult {
  const byItem = new Map<string, PurchaseForAnalysis[]>();
  for (const p of purchases) {
    const list = byItem.get(p.item_name) ?? [];
    list.push(p);
    byItem.set(p.item_name, list);
  }

  // 태그를 상품명 자체로 잡는다 — 상품 카탈로그의 구조화 태그(예: "커피", "동서")가
  // 이 상품명의 부분 문자열이 되므로, 개인화 검색(personalizationBonus)이 여기 붙는다.
  const interests: InterestTag[] = [];
  const lines: string[] = [];
  for (const [item, list] of byItem) {
    const repeat = list.length > 1;
    interests.push({ tag: item, score: list.length, evidence: item });
    lines.push(`- **${item}** — ${list.length}회${repeat ? " (재구매 패턴 감지)" : ""}`);
  }

  const profileMarkdown = `# 내 쇼핑 프로필

_마지막 갱신: ${new Date().toISOString()}_
_생성 방식: mock 분석 — MOCK_LLM=1 또는 DASHSCOPE_API_KEY 미설정 시 이 경로를 탄다_

## 구매 패턴

${lines.join("\n") || "(아직 데이터 없음)"}

## 메모

실제 서비스에서는 이 섹션을 AI가 자유서술로 채운다 (가격 민감도, 선호 브랜드 등).
`;

  return { interests, profileMarkdown };
}

async function callQwen(
  purchases: PurchaseForAnalysis[],
  previousProfileMd: string,
): Promise<AnalysisResult> {
  const baseUrl = process.env.QWEN_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
  const model = process.env.QWEN_MODEL ?? "qwen3-max";

  const system = `너는 개인 쇼핑 데이터를 분석해 취향 프로필을 유지보수하는 에이전트다.
기존 프로필(markdown)과 새 구매내역을 보고, 갱신된 프로필 전체를 markdown으로,
관심사 태그 목록을 함께 반환하라.
반드시 아래 스키마의 JSON 객체 하나만 출력하라:
{"interests": [{"tag": string, "score": number, "evidence": string}], "profileMarkdown": string}`;

  const user = `## 기존 프로필
${previousProfileMd || "(없음, 최초 분석)"}

## 새 구매내역
${JSON.stringify(purchases, null, 2)}`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    throw new Error(`Qwen API 오류: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as any;
  const content: string | undefined = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Qwen 응답에 content가 없음");

  return JSON.parse(content) as AnalysisResult;
}

// --- 상품 상세페이지 → 구조화된 태그 추출 ---
// 크롤링한 title/detail_content를 보고 {name, category} 형태의 태그를 뽑는다.
// category는 "브랜드" | "카테고리" | "속성" | "가격대" 중 하나로 고정해
// 검색/개인화 매칭이 일관되게 동작하도록 한다.
export interface ProductTag {
  name: string;
  category: string;
}

const MOCK_KEYWORD_TAGS: Record<string, string> = {
  커피: "카테고리",
  커피믹스: "카테고리",
  런닝화: "카테고리",
  생수: "카테고리",
  에어랩: "카테고리",
  나이키: "브랜드",
  다이슨: "브랜드",
  동서: "브랜드",
  삼다수: "브랜드",
};

export async function extractProductTags(
  title: string,
  detailContent: string,
  price: number | null,
): Promise<{ tags: ProductTag[] }> {
  if (process.env.MOCK_LLM === "1" || !process.env.DASHSCOPE_API_KEY) {
    return mockExtractTags(title, detailContent, price);
  }
  return callQwenForTags(title, detailContent, price);
}

function mockExtractTags(
  title: string,
  detailContent: string,
  price: number | null,
): { tags: ProductTag[] } {
  const haystack = `${title} ${detailContent}`;
  const tags: ProductTag[] = [];

  for (const [keyword, category] of Object.entries(MOCK_KEYWORD_TAGS)) {
    if (haystack.includes(keyword)) tags.push({ name: keyword, category });
  }

  if (price != null) {
    const band = price < 30_000 ? "3만원 미만" : price < 100_000 ? "3만원~10만원" : "10만원 이상";
    tags.push({ name: band, category: "가격대" });
  }

  if (tags.length === 0) tags.push({ name: "기타", category: "카테고리" });
  return { tags };
}

async function callQwenForTags(
  title: string,
  detailContent: string,
  price: number | null,
): Promise<{ tags: ProductTag[] }> {
  const baseUrl = process.env.QWEN_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
  const model = process.env.QWEN_MODEL ?? "qwen3-max";

  const system = `상품 제목과 상세설명에서 구조화된 태그를 추출하라.
각 태그는 {"name": string, "category": "브랜드"|"카테고리"|"속성"|"가격대"} 형식이다.
반드시 {"tags": [...]} 형식의 JSON 객체 하나만 출력하라.`;

  const user = `제목: ${title}\n가격: ${price ?? "알 수 없음"}\n상세설명:\n${detailContent}`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) throw new Error(`Qwen API 오류: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as any;
  const content: string | undefined = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Qwen 응답에 content가 없음");

  return JSON.parse(content) as { tags: ProductTag[] };
}
