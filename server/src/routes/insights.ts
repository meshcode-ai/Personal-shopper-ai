import { Hono } from "hono";
import { getDb } from "../db/client";
import { dismissInsight, generateInsights, listInsights } from "../core/insights";

export const insightsRoute = new Hono();

// 상단 "쇼핑 어시스턴트" 배너 — 아직 닫지 않은 인사이트만.
insightsRoute.get("/", (c) => {
  return c.json(listInsights(getDb()));
});

// 핫딜 + 매달 절약 인사이트를 새로 만든다. 페이지 로드 때 조용히 한 번씩 호출한다.
insightsRoute.post("/scan", async (c) => {
  const limit = Number(c.req.query("limit") ?? 10);
  return c.json(await generateInsights(getDb(), limit));
});

// "이해했어요, 지워주세요" 버튼 — 닫으면 다시 안 뜬다 (재스캔해도 부활 안 함).
insightsRoute.delete("/:id", (c) => {
  const ok = dismissInsight(getDb(), Number(c.req.param("id")));
  if (!ok) return c.json({ error: "인사이트 없음" }, 404);
  return c.body(null, 204);
});
