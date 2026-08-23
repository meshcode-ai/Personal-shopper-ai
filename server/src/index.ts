import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { analyzeRoute } from "./routes/analyze";
import { chatRoute } from "./routes/chat";
import { dealsRoute } from "./routes/deals";
import { insightsRoute } from "./routes/insights";
import { memoryRoute } from "./routes/memory";
import { productsRoute } from "./routes/products";
import { purchasesRoute } from "./routes/purchases";
import { shopsRoute } from "./routes/shops";
import { spendingRoute } from "./routes/spending";

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, service: "personal-shopper-ai" }));

app.route("/api/shops", shopsRoute);
app.route("/api/purchases", purchasesRoute);
app.route("/api/products", productsRoute);
app.route("/api/analyze", analyzeRoute);
app.route("/api/chat", chatRoute);
app.route("/api/deals", dealsRoute);
app.route("/api/insights", insightsRoute);
app.route("/api/spending", spendingRoute);
app.route("/api/memory", memoryRoute);

// 웹 UI — 빌드 스텝 없는 단일 페이지(web/index.html)를 그대로 서빙.
// Vite 번들링보다 이게 더 단순하고 안전하다.
app.use("/*", serveStatic({ root: "./web" }));

// bun run server/src/index.ts 로 직접 실행될 때만 리슨.
// 테스트(tests/smoke.test.ts)는 app.request()로 이 파일을 서버 없이 직접 호출한다.
if (import.meta.main) {
  const port = Number(process.env.PORT ?? 8787);
  console.log(`🛍️  Personal Shopper AI → http://localhost:${port}`);
  Bun.serve({ port, fetch: app.fetch });
}
