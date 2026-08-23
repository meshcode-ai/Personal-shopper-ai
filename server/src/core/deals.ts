import type { Database } from "bun:sqlite";
import { findBetterPrice, type DealResult } from "../providers/priceSearch";
import { recordPriceSnapshot } from "./priceSnapshots";
import { getProduct } from "./products";
import { getPurchase } from "./purchases";

export interface Deal {
  id: number;
  purchase_id: number;
  found_shop: string;
  found_price: number;
  found_url: string;
  savings_pct: number;
  found_at: string;
}

// 넛지 배너용 — 딜 자체 필드에 원래 뭘 얼마에 샀는지(item_name/original_price/shop_name)를
// 조인해서 붙인다. "곰곰 한돈 등심 돈까스용을 네이버쇼핑에서 더 싸게 살 수 있어요" 같은
// 문장을 프론트에서 추가 조회 없이 바로 만들 수 있게 하기 위함.
export interface DealWithContext extends Deal {
  item_name: string;
  original_price: number;
  shop_name: string;
}

const WITH_CONTEXT_SQL = `
  SELECT d.*, p.item_name AS item_name, p.price AS original_price, s.name AS shop_name
  FROM deals d
  JOIN purchases p ON p.id = d.purchase_id
  JOIN shops s ON s.id = p.shop_id
`;

export function listDeals(db: Database): DealWithContext[] {
  return db.query(`${WITH_CONTEXT_SQL} ORDER BY d.savings_pct DESC`).all() as DealWithContext[];
}

export async function findDealForPurchase(db: Database, purchaseId: number): Promise<Deal> {
  const purchase = getPurchase(db, purchaseId);
  if (!purchase) throw new Error("NOT_FOUND");

  const result = await findBetterPrice(purchase.item_name, purchase.price);

  const insert = db.run(
    `INSERT INTO deals (purchase_id, found_shop, found_price, found_url, savings_pct) VALUES (?, ?, ?, ?, ?)`,
    [purchaseId, result.found_shop, result.found_price, result.found_url, result.savings_pct],
  );

  return db.query("SELECT * FROM deals WHERE id = ?").get(insert.lastInsertRowid) as Deal;
}

// 상품 그리드의 "다른 쇼핑몰 찾기" 버튼용 — 구매내역(purchase) 단위가 아니라
// 카탈로그의 상품(product) 단위로 바로 조회한다. deals 테이블에 쌓지 않고
// (product는 purchase_id가 없어 넛지 피드에 못 들어간다) 결과를 그 자리에서 바로 반환한다 —
// 카드 안에서 즉시 "원가 대비 몇 % 싼지"를 보여주는 용도라 영속화가 필요 없다.
export async function findDealForProduct(
  db: Database,
  productId: number,
): Promise<DealResult & { item_name: string; original_price: number }> {
  const product = getProduct(db, productId);
  if (!product) throw new Error("NOT_FOUND");

  const itemName = product.title ?? "";
  const originalPrice = product.last_price ?? 0;
  const result = await findBetterPrice(itemName, originalPrice);
  recordPriceSnapshot(db, productId, result.found_shop, result.found_price); // 가격 타이밍 조언용 이력 적재

  return { ...result, item_name: itemName, original_price: originalPrice };
}

// 넛지 스캔 — 사용자가 하나하나 "최저가 찾기"를 누를 필요 없이, 아직 딜을 찾아본 적
// 없는 구매내역을 한 번에 훑어서 채운다. 이미 딜이 있는 구매는 건너뛰어(멱등) 같은
// 페이지를 여러 번 새로고침해도 deals 테이블이 부풀지 않는다.
// limit은 한 번의 스캔에서 가격 API(또는 mock)를 몇 번까지 호출할지 상한이다 —
// 구매내역이 아주 많을 때 페이지 로드 한 번에 전부 긁는 걸 막기 위함.
export async function scanForDeals(db: Database, limit = 20): Promise<DealWithContext[]> {
  const candidates = db
    .query(
      `SELECT p.id FROM purchases p
       LEFT JOIN deals d ON d.purchase_id = p.id
       WHERE d.id IS NULL
       ORDER BY p.bought_at DESC
       LIMIT ?`,
    )
    .all(limit) as { id: number }[];

  if (candidates.length === 0) return [];

  const createdIds: number[] = [];
  for (const { id } of candidates) {
    const deal = await findDealForPurchase(db, id);
    createdIds.push(deal.id);
  }

  const placeholders = createdIds.map(() => "?").join(",");
  return db
    .query(`${WITH_CONTEXT_SQL} WHERE d.id IN (${placeholders}) ORDER BY d.savings_pct DESC`)
    .all(...createdIds) as DealWithContext[];
}
