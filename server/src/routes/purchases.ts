import { Hono } from "hono";
import { getDb } from "../db/client";
import { findDealForPurchase } from "../core/deals";

export const purchasesRoute = new Hono();

purchasesRoute.post("/:id/find-deal", async (c) => {
  const id = Number(c.req.param("id"));
  try {
    return c.json(await findDealForPurchase(getDb(), id));
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return c.json({ error: "구매내역 없음" }, 404);
    }
    throw err;
  }
});
