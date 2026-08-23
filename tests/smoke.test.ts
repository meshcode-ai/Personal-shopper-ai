// 스모크 테스트 — "서비스가 죽어있지 않다"를 증명하는 최소 집합.
// 실제 chrome_bridge / Bright Data / Qwen / OS 키체인 호출은 MOCK_* 플래그로 스텁하고,
// 온보딩 → 자격증명 → 싱크 → 상품 카탈로그 → 크롤링/태깅 → 분석 → 검색/개인화 → 추천의
// 엔드투엔드 배관이 끊기지 않았는지만 검증한다.
//
// 실행: bun test  (아래 env는 import보다 먼저 설정되어야 함 — 각 값은 첫 접근 시점에 lazy하게 읽힘)

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workDir = mkdtempSync(join(tmpdir(), "personal-shopper-smoke-"));
process.env.DB_PATH = join(workDir, "test.sqlite");
process.env.MEMORY_DIR = join(workDir, "memory");
process.env.MOCK_LLM = "1";
process.env.MOCK_BRIGHTDATA = "1";
process.env.MOCK_KEYCHAIN = "1";

const { app } = await import("../server/src/index.ts");
const { readFileSync, existsSync } = await import("node:fs");

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON is fine for some endpoints */
  }
  return { status: res.status, json, text };
}

let shopId: number;
let purchaseId: number;
let coffeeProductId: number;

describe("smoke: 서버 기동", () => {
  test("GET /health → 200 ok", async () => {
    const { status, json } = await call("GET", "/health");
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
  });
});

describe("smoke: 온보딩 (샵 CRUD + md 메모리)", () => {
  test("POST /api/shops → 샵 생성 + shops.md 갱신", async () => {
    const { status, json } = await call("POST", "/api/shops", {
      name: "쿠팡",
      base_url: "https://www.coupang.com",
      order_history_url: "https://www.coupang.com/mypage/orders",
    });
    expect(status).toBe(201);
    expect(json.id).toBeGreaterThan(0);
    expect(json.name).toBe("쿠팡");
    shopId = json.id;

    const memoryPath = join(process.env.MEMORY_DIR!, "shops.md");
    expect(existsSync(memoryPath)).toBe(true);
    const md = readFileSync(memoryPath, "utf-8");
    expect(md).toContain("쿠팡");
    expect(md).toContain("https://www.coupang.com");
  });

  test("GET /api/shops → 방금 만든 샵 포함, 비밀번호 필드는 응답에 없음", async () => {
    const { status, json } = await call("GET", "/api/shops");
    expect(status).toBe(200);
    const shop = json.find((s: any) => s.id === shopId);
    expect(shop).toBeTruthy();
    expect(shop.hasCredential).toBe(false);
    expect(shop.password).toBeUndefined();
    expect(shop.credential_ref).toBeUndefined();
  });

  test("중복 이름으로 POST /api/shops → 409", async () => {
    const { status } = await call("POST", "/api/shops", {
      name: "쿠팡",
      base_url: "https://www.coupang.com",
    });
    expect(status).toBe(409);
  });

  test("PATCH /api/shops/:id → 필드 수정 반영", async () => {
    const { status, json } = await call("PATCH", `/api/shops/${shopId}`, {
      order_history_url: "https://www.coupang.com/mypage/orders?tab=all",
    });
    expect(status).toBe(200);
    expect(json.order_history_url).toContain("tab=all");
  });
});

describe("smoke: 온보딩 넛지 (나라 추정 → 흔한 몰 후보 리스트업)", () => {
  test("GET /api/shops/suggestions → 쿠팡 등록 → KR 추정 + 후보 목록", async () => {
    const { status, json } = await call("GET", "/api/shops/suggestions");
    expect(status).toBe(200);
    expect(json.inferred_country).toBe("KR");
    expect(json.based_on).toContain("쿠팡");
    const names = json.suggestions.map((s: any) => s.name);
    expect(names).toContain("11번가");
    expect(names).not.toContain("쿠팡"); // 이미 등록된 몰은 후보에서 빠진다
  });
});

describe("smoke: 자격증명 (OS 키체인 mock — 비밀번호는 DB에 남지 않는다)", () => {
  test("POST /api/shops/:id/credentials → 저장 성공, 응답엔 비밀번호 없음", async () => {
    const { status, json } = await call("POST", `/api/shops/${shopId}/credentials`, {
      username: "myid",
      password: "super-secret",
    });
    expect(status).toBe(201);
    expect(json.username).toBe("myid");
    expect(json.password).toBeUndefined();

    const shops = await call("GET", "/api/shops");
    expect(shops.json.find((s: any) => s.id === shopId).hasCredential).toBe(true);
  });

  test("DELETE /api/shops/:id/credentials → 해제", async () => {
    const { status } = await call("DELETE", `/api/shops/${shopId}/credentials`);
    expect(status).toBe(204);

    const shops = await call("GET", "/api/shops");
    expect(shops.json.find((s: any) => s.id === shopId).hasCredential).toBe(false);
  });
});

describe("smoke: 구매내역 싱크 (fixture 기반, chrome_bridge 대역)", () => {
  test("POST /api/shops/:id/sync → fixture 주문 임포트", async () => {
    const { status, json } = await call("POST", `/api/shops/${shopId}/sync`);
    expect(status).toBe(200);
    expect(json.imported).toBeGreaterThan(0);
    purchaseId = json.purchases[0].id;
  });

  test("같은 샵 다시 sync → UNIQUE 제약으로 중복 적재 안 됨", async () => {
    const first = await call("GET", `/api/shops/${shopId}/purchases`);
    const before = first.json.length;
    await call("POST", `/api/shops/${shopId}/sync`);
    const second = await call("GET", `/api/shops/${shopId}/purchases`);
    expect(second.json.length).toBe(before);
  });
});

describe("smoke: 상품 카탈로그 (구매내역 → 자동 집계, 탭 필터)", () => {
  test("GET /api/products?shop_id= → 재구매 상품의 purchase_count가 누적됨", async () => {
    const { status, json } = await call("GET", `/api/products?shop_id=${shopId}`);
    expect(status).toBe(200);
    expect(json.length).toBeGreaterThan(0);

    const coffee = json.find((p: any) => p.title?.includes("커피"));
    expect(coffee).toBeTruthy();
    expect(coffee.purchase_count).toBe(2); // fixture에서 2번 구매, sync 재실행에도 부풀지 않음
    coffeeProductId = coffee.id;

    const water = json.find((p: any) => p.title?.includes("삼다수"));
    expect(water.purchase_count).toBe(2);
  });
});

describe("smoke: 상품 상세 크롤링 + 구조화 태그", () => {
  test("POST /api/products/:id/enrich → 상세설명 채움 + {name,category} 태그 부착", async () => {
    const { status, json } = await call("POST", `/api/products/${coffeeProductId}/enrich`);
    expect(status).toBe(200);
    expect(json.detail_content).toBeTruthy();
    expect(json.tags.length).toBeGreaterThan(0);
    for (const tag of json.tags) {
      expect(typeof tag.name).toBe("string");
      expect(typeof tag.category).toBe("string");
    }
    expect(json.tags.some((t: any) => t.category === "브랜드")).toBe(true);
  });
});

describe("smoke: 취향 분석 (Qwen 대역, PROFILE.md 갱신)", () => {
  test("POST /api/analyze → interests 생성 + PROFILE.md 갱신", async () => {
    const { status, json } = await call("POST", "/api/analyze");
    expect(status).toBe(200);
    expect(Array.isArray(json.interests)).toBe(true);
    expect(json.interests.length).toBeGreaterThan(0);

    const profilePath = join(process.env.MEMORY_DIR!, "PROFILE.md");
    expect(existsSync(profilePath)).toBe(true);
    const md = readFileSync(profilePath, "utf-8");
    expect(md.length).toBeGreaterThan(0);
  });

  test("GET /api/memory/profile → 방금 갱신된 md 반환", async () => {
    const { status, text } = await call("GET", "/api/memory/profile");
    expect(status).toBe(200);
    expect(text).toContain("#");
  });
});

describe("smoke: Qwen 퍼스널 쇼핑 채팅", () => {
  test("POST /api/chat → 구매·딜 문맥의 mock 응답", async () => {
    const { status, json } = await call("POST", "/api/chat", {
      message: "해외몰에서 살 러닝화 검색어를 한국어로 알려줘",
    });
    expect(status).toBe(200);
    expect(json.mode).toBe("mock");
    expect(typeof json.message).toBe("string");
    expect(json.message.length).toBeGreaterThan(10);
  });

  test("POST /api/chat → 빈 메시지는 400", async () => {
    const { status } = await call("POST", "/api/chat", { message: "  " });
    expect(status).toBe(400);
  });
});

describe("smoke: 검색 — 상단 검색바 + 개인화 정렬", () => {
  test("GET /api/products?query=커피 → 텍스트 매칭", async () => {
    const { status, json } = await call("GET", "/api/products?query=커피");
    expect(status).toBe(200);
    expect(json.some((p: any) => p.title?.includes("커피"))).toBe(true);
  });

  test("개인화 켬(기본) — 태그가 관심사와 겹치면 score > 0", async () => {
    const { json } = await call("GET", "/api/products");
    const coffee = json.find((p: any) => p.id === coffeeProductId);
    expect(coffee.score).toBeGreaterThan(0);
  });

  test("personalized=0 → 개인화 보너스 제외, 검색어도 없으면 score는 0", async () => {
    const { json } = await call("GET", "/api/products?personalized=0");
    const coffee = json.find((p: any) => p.id === coffeeProductId);
    expect(coffee.score).toBe(0);
  });
});

describe("smoke: 최저가 탐색 (Bright Data 대역)", () => {
  test("POST /api/purchases/:id/find-deal → deal 기록", async () => {
    const { status, json } = await call("POST", `/api/purchases/${purchaseId}/find-deal`);
    expect(status).toBe(200);
    expect(json.found_price).toBeGreaterThan(0);
    expect(typeof json.savings_pct).toBe("number");
  });

  test("GET /api/deals → 방금 찾은 딜 포함, item_name/shop_name 컨텍스트 포함 (넛지 배너용)", async () => {
    const { status, json } = await call("GET", "/api/deals");
    expect(status).toBe(200);
    expect(json.length).toBeGreaterThan(0);
    expect(json[0].item_name).toBeTruthy();
    expect(json[0].shop_name).toBeTruthy();
  });

  test("POST /api/deals/scan → 아직 딜 없는 구매내역만 훑는다 (넛지)", async () => {
    const before = (await call("GET", "/api/deals")).json.length;
    const { status, json: scanned } = await call("POST", "/api/deals/scan");
    expect(status).toBe(200);
    // purchaseId는 위에서 이미 find-deal을 했으니 스캔 대상에서 제외되고,
    // 나머지 미스캔 구매내역만 새로 채워진다.
    expect(scanned.every((d: any) => d.purchase_id !== purchaseId)).toBe(true);

    const after = (await call("GET", "/api/deals")).json.length;
    expect(after).toBe(before + scanned.length);
  });

  test("POST /api/deals/scan 재호출 → 이미 다 채웠으니 멱등 (새로 생기는 게 없음)", async () => {
    const { status, json } = await call("POST", "/api/deals/scan");
    expect(status).toBe(200);
    expect(json.length).toBe(0);
  });
});

describe("smoke: 실데이터 임포트 (chrome_bridge 대역 — agent가 직접 스크랩해 넣는 경로)", () => {
  test("POST /api/shops/:id/purchases/import → 임의 주문 반영", async () => {
    const { status, json } = await call("POST", `/api/shops/${shopId}/purchases/import`, {
      orders: [
        {
          item_name: "테스트 전용 상품",
          price: 9900,
          quantity: 1,
          bought_at: "2026-08-01",
          product_url: "https://www.coupang.com/vp/products/9999999",
        },
      ],
    });
    expect(status).toBe(200);
    expect(json.source).toBe("chrome_bridge");
    expect(json.imported).toBe(1);
  });

  test("orders 빈 배열 → 400", async () => {
    const { status } = await call("POST", `/api/shops/${shopId}/purchases/import`, { orders: [] });
    expect(status).toBe(400);
  });
});

describe("smoke: 데모 시드 매트릭스 (알리익스프레스 · 네이버쇼핑 · 크림)", () => {
  test.each(["알리익스프레스", "네이버쇼핑", "크림"])("%s → 샵 생성 + 데모 시드 성공", async (name) => {
    const created = await call("POST", "/api/shops", {
      name,
      base_url: "https://example.com",
    });
    expect(created.status).toBe(201);

    const synced = await call("POST", `/api/shops/${created.json.id}/sync`);
    expect(synced.status).toBe(200);
    expect(synced.json.source).toBe("demo");
    expect(synced.json.imported).toBeGreaterThan(0);
  });

  test("데모 데이터 없는 샵 이름 → 404 + 실데이터 경로 안내", async () => {
    const created = await call("POST", "/api/shops", { name: "무명몰", base_url: "https://example.com" });
    const synced = await call("POST", `/api/shops/${created.json.id}/sync`);
    expect(synced.status).toBe(404);
    expect(synced.json.hint).toContain("purchases/import");
  });
});

describe("smoke: 상세 크롤링 폴백 체인 (Bright Data/데모 실패 → chrome_bridge 수동 제출)", () => {
  let fallbackShopId: number;
  let fallbackProductId: number;

  test("데모 카탈로그에 없는 상품 → enrich는 502 + chrome_bridge 폴백 안내", async () => {
    const shop = await call("POST", "/api/shops", { name: "무명몰2", base_url: "https://example.com" });
    fallbackShopId = shop.json.id;

    const imported = await call("POST", `/api/shops/${fallbackShopId}/purchases/import`, {
      orders: [
        {
          item_name: "출처 불명 상품",
          price: 5000,
          quantity: 1,
          bought_at: "2026-08-10",
          product_url: "https://example.com/products/1",
        },
      ],
    });
    fallbackProductId = imported.json.purchases[0].product_id;

    const enrich = await call("POST", `/api/products/${fallbackProductId}/enrich`);
    expect(enrich.status).toBe(502);
    expect(enrich.json.fallback).toBe("chrome_bridge");
    expect(enrich.json.hint).toContain(`/api/products/${fallbackProductId}/detail`);
  });

  test("POST /api/products/:id/detail → 수동 제출로 태그까지 완성", async () => {
    const { status, json } = await call("POST", `/api/products/${fallbackProductId}/detail`, {
      title: "출처 불명 상품 (직접 크롤링)",
      description: "chrome_bridge로 직접 읽은 설명",
      detail_content: "나이키 정품, 3만원 미만",
      image_url: null,
    });
    expect(status).toBe(200);
    expect(json.detail_content).toContain("나이키");
    expect(json.tags.length).toBeGreaterThan(0);
  });
});

describe("smoke: 삭제 cascade", () => {
  test("DELETE /api/shops/:id → 연결된 purchases/products까지 정리", async () => {
    const del = await call("DELETE", `/api/shops/${shopId}`);
    expect(del.status).toBe(204);

    const purchases = await call("GET", `/api/shops/${shopId}/purchases`);
    expect(purchases.status).toBe(404);

    const products = await call("GET", `/api/products?shop_id=${shopId}`);
    expect(products.json.length).toBe(0);
  });
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});
