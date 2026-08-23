import { Hono } from "hono";
import { getDb } from "../db/client";
import * as CredentialsCore from "../core/credentials";
import * as PurchasesCore from "../core/purchases";
import * as ShopsCore from "../core/shops";
import { suggestShops } from "../core/shopSuggestions";

export const shopsRoute = new Hono();

// 원본 Shop에는 credential_ref(키체인 참조 키)가 들어있다 — 비밀은 아니지만
// 내부 구현 디테일이라 API 응답에서는 hasCredential 불리언으로만 노출한다.
function serializeShop(shop: ShopsCore.Shop) {
  const { credential_ref, credential_username, ...rest } = shop;
  return {
    ...rest,
    hasCredential: Boolean(credential_ref),
    credentialUsername: credential_username ?? null,
  };
}

shopsRoute.get("/", (c) => {
  return c.json(ShopsCore.listShops(getDb()).map(serializeShop));
});

// 온보딩 넛지 — 등록된 샵 도메인으로 나라를 추정해 그 나라 사람들이 흔히 같이 쓰는
// 몰 후보를 내려준다. add_shop을 대신 호출하지 않는다 — 사용자가 "맞다"고 확인한 것만
// 에이전트가 이어서 등록/chrome_bridge 임포트해야 한다.
shopsRoute.get("/suggestions", (c) => {
  return c.json(suggestShops(getDb()));
});

shopsRoute.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.name || !body?.base_url) {
    return c.json({ error: "name, base_url는 필수" }, 400);
  }

  try {
    const shop = ShopsCore.createShop(getDb(), body);
    return c.json(serializeShop(shop), 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("UNIQUE")) {
      return c.json({ error: `이미 등록된 샵: ${body.name}` }, 409);
    }
    throw err;
  }
});

shopsRoute.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  const shop = ShopsCore.updateShop(getDb(), id, body);
  if (!shop) return c.json({ error: "샵 없음" }, 404);
  return c.json(serializeShop(shop));
});

// 자격증명은 별도 경로로만 다룬다 — 비밀번호는 응답에 절대 실리지 않는다.
shopsRoute.post("/:id/credentials", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => null);
  if (!body?.username || !body?.password) {
    return c.json({ error: "username, password는 필수" }, 400);
  }
  try {
    const result = await CredentialsCore.setShopCredential(getDb(), id, body.username, body.password);
    return c.json(result, 201);
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") return c.json({ error: "샵 없음" }, 404);
    throw err;
  }
});

shopsRoute.delete("/:id/credentials", async (c) => {
  const id = Number(c.req.param("id"));
  try {
    await CredentialsCore.removeShopCredential(getDb(), id);
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") return c.json({ error: "샵 없음" }, 404);
    throw err;
  }
});

shopsRoute.delete("/:id", (c) => {
  const id = Number(c.req.param("id"));
  const deleted = ShopsCore.deleteShop(getDb(), id);
  if (!deleted) return c.json({ error: "샵 없음" }, 404);
  return c.body(null, 204);
});

shopsRoute.get("/:id/purchases", (c) => {
  const db = getDb();
  const id = Number(c.req.param("id"));
  if (!ShopsCore.getShop(db, id)) return c.json({ error: "샵 없음" }, 404);
  return c.json(PurchasesCore.listPurchasesForShop(db, id));
});

// 데모 시드 — 샵 이름이 "쿠팡/네이버쇼핑/알리익스프레스/크림"과 일치할 때만 동작한다.
// 실데이터는 /purchases/import를 쓴다 (AI 에이전트가 chrome_bridge로 스크랩한 결과).
shopsRoute.post("/:id/sync", async (c) => {
  const db = getDb();
  const id = Number(c.req.param("id"));
  try {
    return c.json(await PurchasesCore.seedDemoPurchases(db, id));
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") return c.json({ error: "샵 없음" }, 404);
    if (err instanceof Error && err.message === "NO_DEMO_DATA") {
      return c.json(
        {
          error: "이 샵 이름에 대한 데모 데이터가 없습니다.",
          hint: "실데이터는 POST /api/shops/:id/purchases/import 로 넣으세요 (chrome_bridge 스크랩 결과).",
        },
        404,
      );
    }
    throw err;
  }
});

// 실데이터 경로 — AI 에이전트가 chrome_bridge로 사용자의 이미 로그인된 브라우저에서
// 직접 스크랩한 주문내역 배열을 그대로 넣는다.
shopsRoute.post("/:id/purchases/import", async (c) => {
  const db = getDb();
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => null);
  if (!Array.isArray(body?.orders) || body.orders.length === 0) {
    return c.json({ error: "orders 배열이 필요합니다 (item_name, price, quantity, bought_at, product_url)" }, 400);
  }
  try {
    return c.json(await PurchasesCore.importPurchases(db, id, body.orders));
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") return c.json({ error: "샵 없음" }, 404);
    throw err;
  }
});
