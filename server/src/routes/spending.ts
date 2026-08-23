import { Hono } from "hono";
import { getDb } from "../db/client";
import { getSpendingReport } from "../core/spending";

export const spendingRoute = new Hono();

// 최근 30일 vs 그 이전 30일 지출을 카테고리별로 비교한다.
spendingRoute.get("/report", (c) => {
  return c.json(getSpendingReport(getDb()));
});
