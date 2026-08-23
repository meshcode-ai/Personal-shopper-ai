import { Hono } from "hono";
import { getDb } from "../db/client";
import { listDeals, scanForDeals } from "../core/deals";

export const dealsRoute = new Hono();

dealsRoute.get("/", (c) => {
  return c.json(listDeals(getDb()));
});

// 넛지 스캔 — 아직 딜을 안 찾아본 구매내역을 한 번에 훑어 채운다.
// 프론트는 페이지 로드/동기화 직후 이걸 조용히 호출해 "발견된 딜"을 자동으로 띄운다
// (사용자가 구매내역 하나하나에서 "최저가 찾기"를 누를 필요가 없다).
dealsRoute.post("/scan", async (c) => {
  const limit = Number(c.req.query("limit") ?? 20);
  return c.json(await scanForDeals(getDb(), limit));
});
