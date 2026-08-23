import { Hono } from "hono";
import { getDb } from "../db/client";
import { findDealForProduct } from "../core/deals";
import { listInterests } from "../core/interests";
import { discoverProduct, enrichProductDetail, searchProducts, setTargetPrice, submitProductDetail } from "../core/products";

export const productsRoute = new Hono();

// 그리드/탭 목록 + 상단 검색을 겸한다.
// ?shop_id=      쇼핑몰 탭 필터
// ?query=        검색어 (제목/설명/태그)
// ?personalized= "0"이면 개인화 점수 보너스 제외 (기본은 켜짐)
productsRoute.get("/", (c) => {
  const db = getDb();
  const shopIdParam = c.req.query("shop_id");
  const query = c.req.query("query") || undefined;
  const personalized = c.req.query("personalized") !== "0";

  const results = searchProducts(
    db,
    { shopId: shopIdParam ? Number(shopIdParam) : undefined, query, personalized },
    listInterests(db),
  );
  return c.json(results);
});

// 구매 없이 "관심 상품"만 등록한다 (예: 크림에서 둘러본 흥미로운 상품).
// purchase_count 없이 그리드/개인화 검색 대상에만 올리고 싶을 때 쓴다.
productsRoute.post("/discover", async (c) => {
  const db = getDb();
  const body = await c.req.json().catch(() => null);
  if (!body?.shop_id || !body?.item_name || !body?.product_url) {
    return c.json({ error: "shop_id, item_name, product_url은 필수" }, 400);
  }
  try {
    const product = await discoverProduct(db, Number(body.shop_id), {
      item_name: body.item_name,
      price: body.price ?? 0,
      product_url: body.product_url,
      description: body.description,
      detail_content: body.detail_content,
      image_url: body.image_url,
    });
    return c.json(product, 201);
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") return c.json({ error: "샵 없음" }, 404);
    throw err;
  }
});

// 우선순위: Bright Data(공개 데이터 크롤러) → 데모 시드. 둘 다 못 다루면 502 +
// chrome_bridge 폴백 안내를 준다 (agent가 /:id/detail로 직접 제출하도록).
productsRoute.post("/:id/enrich", async (c) => {
  const db = getDb();
  const id = Number(c.req.param("id"));
  try {
    return c.json(await enrichProductDetail(db, id));
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") return c.json({ error: "상품 없음" }, 404);
    if (err instanceof Error && err.message === "NO_DETAIL_SOURCE") {
      return c.json(
        {
          error: "Bright Data와 데모 데이터 모두 이 상품을 다루지 못했습니다.",
          fallback: "chrome_bridge",
          hint: `AI 에이전트가 직접 상세페이지를 열어 POST /api/products/${id}/detail 로 제출하세요.`,
        },
        502,
      );
    }
    throw err;
  }
});

// 상품 그리드 "다른 쇼핑몰 찾기" 버튼 — Bright Data(공개 데이터 크롤러)로 같은/유사
// 상품을 다른 몰에서 검색해 원가 대비 얼마나 싼지 그 자리에서 바로 보여준다.
productsRoute.post("/:id/find-deal", async (c) => {
  const db = getDb();
  const id = Number(c.req.param("id"));
  try {
    return c.json(await findDealForProduct(db, id));
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") return c.json({ error: "상품 없음" }, 404);
    throw err;
  }
});

// 워치리스트 — 목표가 등록/해제. { target_price: number } 또는 { target_price: null }.
productsRoute.patch("/:id/watch", async (c) => {
  const db = getDb();
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => null);
  if (body?.target_price !== null && typeof body?.target_price !== "number") {
    return c.json({ error: "target_price는 숫자 또는 null이어야 합니다" }, 400);
  }
  const product = setTargetPrice(db, id, body.target_price);
  if (!product) return c.json({ error: "상품 없음" }, 404);
  return c.json(product);
});

// chrome_bridge 폴백 — AI 에이전트가 사용자의 브라우저로 직접 연 상세페이지
// 내용을 그대로 제출한다. 서버는 여기서도 동일하게 Qwen 태그 추출을 돌린다.
productsRoute.post("/:id/detail", async (c) => {
  const db = getDb();
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => null);
  if (!body?.title) {
    return c.json({ error: "title은 필수, description/detail_content/image_url은 선택" }, 400);
  }
  try {
    return c.json(
      await submitProductDetail(db, id, {
        title: body.title,
        description: body.description ?? null,
        detail_content: body.detail_content ?? null,
        image_url: body.image_url ?? null,
      }),
    );
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") return c.json({ error: "상품 없음" }, 404);
    throw err;
  }
});
