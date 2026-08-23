import { Hono } from "hono";
import { getDb } from "../db/client";
import { listDeals } from "../core/deals";
import { readProfile } from "../memory/store";
import { chatWithPersonalShopper } from "../providers/llm";

export const chatRoute = new Hono();

chatRoute.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return c.json({ error: "message는 필수입니다." }, 400);
  if (message.length > 1_000) return c.json({ error: "message는 1,000자 이하여야 합니다." }, 400);

  const db = getDb();
  const purchases = db
    .query(
      `SELECT p.item_name, p.price, s.name AS shop_name, p.bought_at
       FROM purchases p JOIN shops s ON s.id = p.shop_id
       ORDER BY p.bought_at DESC LIMIT 20`,
    )
    .all() as Array<{ item_name: string; price: number; shop_name: string; bought_at: string | null }>;
  const deals = listDeals(db).map(({ item_name, found_shop, found_price, savings_pct }) => ({
    item_name,
    found_shop,
    found_price,
    savings_pct,
  }));

  try {
    return c.json(await chatWithPersonalShopper(message, { profileMarkdown: readProfile(), purchases, deals }));
  } catch (error) {
    console.error("Personal shopper chat failed", error);
    return c.json({ error: "쇼핑 AI가 잠시 응답하지 못했습니다. 잠시 후 다시 시도해 주세요." }, 502);
  }
});
