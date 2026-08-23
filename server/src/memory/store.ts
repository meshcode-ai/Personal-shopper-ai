// md 중심 메모리 — 에이전트의 시스템 컨텍스트로 그대로 읽히는 사람이 읽을 수 있는 파일들.
// 진짜 소스는 SQLite다. 이 파일들은 항상 DB로부터 "통째로 재생성"되어 드리프트가 없다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function memoryDir(): string {
  const dir = process.env.MEMORY_DIR ?? join(process.cwd(), "memory");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function shopsMdPath(): string {
  return join(memoryDir(), "shops.md");
}

export function profileMdPath(): string {
  return join(memoryDir(), "PROFILE.md");
}

export function readProfile(): string {
  const path = profileMdPath();
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

export function writeProfile(markdown: string): void {
  writeFileSync(profileMdPath(), markdown, "utf-8");
}

interface ShopForMemory {
  id: number;
  name: string;
  base_url: string;
  order_history_url: string | null;
  last_synced_at: string | null;
}

// 샵이 추가/수정/삭제될 때마다 호출된다. 에이전트는 이 파일을 읽고
// add_shop / update_shop / remove_shop 툴로 다시 DB를 바꾸는 순환 구조다.
export function syncShopsMemory(shops: ShopForMemory[]): void {
  const rows = shops
    .map(
      (s) =>
        `| ${s.id} | ${s.name} | ${s.base_url} | ${s.order_history_url ?? "-"} | ${s.last_synced_at ?? "아직 안 함"} |`,
    )
    .join("\n");

  const md = `# 등록된 쇼핑몰

이 파일은 SQLite \`shops\` 테이블의 md 미러다. 직접 편집하지 말 것 — 다음 변경 시 덮어써진다.
에이전트는 add_shop / update_shop / remove_shop 툴로만 이 목록을 바꾼다.

| id | 이름 | 주소 | 주문내역 URL | 마지막 동기화 |
| --- | --- | --- | --- | --- |
${rows || "| - | (등록된 샵 없음) | - | - | - |"}
`;

  writeFileSync(shopsMdPath(), md, "utf-8");
}
