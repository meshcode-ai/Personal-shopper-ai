import type { Database } from "bun:sqlite";
import { syncShopsMemory } from "../memory/store";

export interface Shop {
  id: number;
  name: string;
  base_url: string;
  order_history_url: string | null;
  logo_url: string | null;
  credential_username: string | null;
  credential_ref: string | null;
  parser_version: number;
  last_synced_at: string | null;
  created_at: string;
}

export function listShops(db: Database): Shop[] {
  return db.query("SELECT * FROM shops ORDER BY id").all() as Shop[];
}

export function getShop(db: Database, id: number): Shop | null {
  return (db.query("SELECT * FROM shops WHERE id = ?").get(id) as Shop | undefined) ?? null;
}

export interface CreateShopInput {
  name: string;
  base_url: string;
  order_history_url?: string;
  logo_url?: string;
  credential_ref?: string;
}

export function createShop(db: Database, input: CreateShopInput): Shop {
  const result = db.run(
    `INSERT INTO shops (name, base_url, order_history_url, logo_url, credential_ref) VALUES (?, ?, ?, ?, ?)`,
    [
      input.name,
      input.base_url,
      input.order_history_url ?? null,
      input.logo_url ?? null,
      input.credential_ref ?? null,
    ],
  );
  const shop = getShop(db, Number(result.lastInsertRowid))!;
  refreshMemory(db);
  return shop;
}

// credential_ref/credential_username은 여기서 건드리지 않는다 — 자격증명은
// core/credentials.ts(→ OS 키체인) 경로로만 바뀐다. 일반 PATCH로 비밀 참조를
// 덮어쓸 수 있게 열어두지 않기 위한 의도적인 제한이다.
export type UpdateShopInput = Partial<Pick<Shop, "name" | "base_url" | "order_history_url" | "logo_url">>;

export function updateShop(db: Database, id: number, fields: UpdateShopInput): Shop | null {
  const existing = getShop(db, id);
  if (!existing) return null;

  const merged = { ...existing, ...fields };
  db.run(`UPDATE shops SET name = ?, base_url = ?, order_history_url = ?, logo_url = ? WHERE id = ?`, [
    merged.name,
    merged.base_url,
    merged.order_history_url,
    merged.logo_url,
    id,
  ]);
  refreshMemory(db);
  return getShop(db, id);
}

export function deleteShop(db: Database, id: number): boolean {
  const existing = getShop(db, id);
  if (!existing) return false;
  db.run(`DELETE FROM shops WHERE id = ?`, [id]); // ON DELETE CASCADE → purchases도 정리
  refreshMemory(db);
  return true;
}

export function markSynced(db: Database, id: number): void {
  db.run(`UPDATE shops SET last_synced_at = datetime('now') WHERE id = ?`, [id]);
  refreshMemory(db);
}

function refreshMemory(db: Database): void {
  syncShopsMemory(listShops(db));
}
