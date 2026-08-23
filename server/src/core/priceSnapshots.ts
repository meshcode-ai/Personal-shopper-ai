import type { Database } from "bun:sqlite";

// deals.ts(findDealForProduct)와 insights.ts(generateMonthlySavingInsights) 양쪽에서
// 부르므로, 순환 참조를 피하려고 독립 모듈로 뺐다.
export interface PriceSnapshot {
  id: number;
  product_id: number;
  shop_name: string;
  price: number;
  checked_at: string;
}

export function recordPriceSnapshot(db: Database, productId: number, shopName: string, price: number): void {
  db.run(`INSERT INTO price_snapshots (product_id, shop_name, price) VALUES (?, ?, ?)`, [productId, shopName, price]);
}

export function getRecentSnapshots(db: Database, productId: number, limit = 10): PriceSnapshot[] {
  return db
    .query(`SELECT * FROM price_snapshots WHERE product_id = ? ORDER BY checked_at DESC LIMIT ?`)
    .all(productId, limit) as PriceSnapshot[];
}

export function countSnapshots(db: Database, productId: number): number {
  return (
    db.query(`SELECT COUNT(*) AS cnt FROM price_snapshots WHERE product_id = ?`).get(productId) as { cnt: number }
  ).cnt;
}
