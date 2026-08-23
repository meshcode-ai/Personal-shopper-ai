import { Hono } from "hono";
import { readProfile } from "../memory/store";

export const memoryRoute = new Hono();

// PROFILE.md를 그대로 텍스트로 반환 — 프론트에서 마크다운 렌더러로 그대로 뿌린다.
memoryRoute.get("/profile", (c) => {
  return c.text(readProfile());
});
