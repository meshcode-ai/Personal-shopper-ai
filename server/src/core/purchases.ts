import type { Database } from "bun:sqlite";
import { getDemoShop, type OrderInput } from "./demo-data";
import { findOrCreateProduct, recordProductPurchase } from "./products";
import { getShop, markSynced } from "./shops";

export interface Purchase {
  id: number;
  shop_id: number;
  product_id: number | null;
  item_name: string;
  price: number;
  quantity: number;
  bought_at: string | null;
  product_url: string | null;
  raw_json: string | null;
}

export function listPurchasesForShop(db: Database, shopId: number): Purchase[] {
  return db
    .query("SELECT * FROM purchases WHERE shop_id = ? ORDER BY bought_at DESC")
    .all(shopId) as Purchase[];
}

export function getPurchase(db: Database, id: number): Purchase | null {
  return (db.query("SELECT * FROM purchases WHERE id = ?").get(id) as Purchase | undefined) ?? null;
}

// 실제 sync든 데모 시드든 최종적으로 여기로 모인다:
// 상품 카탈로그 upsert → purchases upsert (raw_json 보존) → 신규 행일 때만 purchase_count++.
function insertOrders(db: Database, shopId: number, orders: OrderInput[]) {
  const insert = db.prepare(
    `INSERT INTO purchases (shop_id, product_id, item_name, price, quantity, bought_at, product_url, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(shop_id, product_url, bought_at) DO NOTHING`,
  );

  let imported = 0;
  for (const order of orders) {
    const productId = findOrCreateProduct(db, shopId, order);
    const result = insert.run(
      shopId,
      productId,
      order.item_name,
      order.price,
      order.quantity,
      order.bought_at,
      order.product_url,
      JSON.stringify(order),
    );
    // purchase_count는 실제로 새 구매행이 적재됐을 때만 올린다 —
    // 같은 sync/import를 반복 호출해도 상품 카탈로그가 부풀지 않도록.
    if (result.changes > 0) {
      imported += 1;
      recordProductPurchase(db, productId, order.price);
    }
  }

  markSynced(db, shopId);
  return { imported, purchases: listPurchasesForShop(db, shopId) };
}

// 데모 시드 경로 — 샵 이름이 "쿠팡/네이버쇼핑/알리익스프레스/크림"과 정확히
// 일치할 때만 동작한다. 실제 서비스에서는 이 경로 대신 AI 에이전트가
// chrome_bridge로 직접 스크랩한 데이터를 importPurchases()로 넣는다.
// 매칭되는 데모 데이터가 없으면 NO_DEMO_DATA를 던져 호출자가 실데이터
// 경로(/purchases/import)로 안내할 수 있게 한다.
export async function seedDemoPurchases(db: Database, shopId: number) {
  const shop = getShop(db, shopId);
  if (!shop) throw new Error("NOT_FOUND");

  const demo = getDemoShop(shop.name);
  if (!demo) throw new Error("NO_DEMO_DATA");

  return { ...insertOrders(db, shopId, demo.orders), source: "demo" as const };
}

// 실데이터 경로 — AI 에이전트가 chrome_bridge로 사용자의 이미 로그인된
// 브라우저에서 직접 스크랩한 주문내역을 그대로 받는다.
// GETTING_STARTED.md의 온보딩 플레이북이 이 엔드포인트를 호출하도록 안내한다.
export async function importPurchases(db: Database, shopId: number, orders: OrderInput[]) {
  const shop = getShop(db, shopId);
  if (!shop) throw new Error("NOT_FOUND");
  if (!Array.isArray(orders) || orders.length === 0) throw new Error("EMPTY_ORDERS");

  return { ...insertOrders(db, shopId, orders), source: "chrome_bridge" as const };
}
