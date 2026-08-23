import { Hono } from "hono";
import { getDb } from "../db/client";
import { runAnalysis } from "../core/interests";

export const analyzeRoute = new Hono();

analyzeRoute.post("/", async (c) => {
  return c.json(await runAnalysis(getDb()));
});
