import type { Database } from "bun:sqlite";
import { fetchProductDetail } from "../providers/brightdata";
import { extractProductTags, type ProductTag } from "../providers/qwen";
import { getDemoProductDetail } from "./demo-data";
import type { Interest } from "./interests";
import { getShop } from "./shops";

export interface Tag {
  id: number;
  name: string;
  category: string | null;
}

export interface Product {
  id: number;
  shop_id: number;
  product_url: string;
  title: string | null;
  description: string | null;
  detail_content: string | null;
  image_url: string | null;
  last_price: number | null;
  purchase_count: number;
  last_crawled_at: string | null;
  target_price: number | null;
  created_at: string;
}

export interface ProductWithTags extends Product {
  tags: Tag[];
}

export function getProduct(db: Database, id: number): Product | null {
  return (db.query("SELECT * FROM products WHERE id = ?").get(id) as Product | undefined) ?? null;
}

export function getProductTags(db: Database, productId: number): Tag[] {
  return db
    .query(
      `SELECT t.* FROM tags t
       JOIN product_tags pt ON pt.tag_id = t.id
       WHERE pt.product_id = ?
       ORDER BY t.name`,
    )
    .all(productId) as Tag[];
}

// 구매내역 한 건이 들어올 때 "이 URL의 상품" 레코드를 찾거나 만든다.
// purchase_count 증가는 여기서 하지 않는다 — 실제로 새 구매행이 적재됐을 때만
// recordProductPurchase()가 별도로 올려서, 같은 sync를 반복 호출해도 안전하다.
export function findOrCreateProduct(
  db: Database,
  shopId: number,
  order: { item_name: string; price: number; product_url: string },
): number {
  const existing = db
    .query("SELECT id FROM products WHERE shop_id = ? AND product_url = ?")
    .get(shopId, order.product_url) as { id: number } | undefined;
  if (existing) return existing.id;

  const result = db.run(
    `INSERT INTO products (shop_id, product_url, title, last_price, purchase_count) VALUES (?, ?, ?, ?, 0)`,
    [shopId, order.product_url, order.item_name, order.price],
  );
  return Number(result.lastInsertRowid);
}

// 워치리스트 — "이 가격 이하로 떨어지면 알려줘". null이면 해제.
export function setTargetPrice(db: Database, productId: number, targetPrice: number | null): Product | null {
  const result = db.run(`UPDATE products SET target_price = ? WHERE id = ?`, [targetPrice, productId]);
  if (result.changes === 0) return null;
  return getProduct(db, productId);
}

export function recordProductPurchase(db: Database, productId: number, price: number): void {
  db.run(`UPDATE products SET last_price = ?, purchase_count = purchase_count + 1 WHERE id = ?`, [
    price,
    productId,
  ]);
}

interface DetailFields {
  title: string;
  description: string | null;
  detail_content: string | null;
  image_url: string | null;
}

function saveDetailAndTag(db: Database, productId: number, price: number | null, detail: DetailFields) {
  db.run(
    `UPDATE products
     SET title = ?, description = ?, detail_content = ?, image_url = ?, last_crawled_at = datetime('now')
     WHERE id = ?`,
    [detail.title, detail.description, detail.detail_content, detail.image_url, productId],
  );
  return extractProductTags(detail.title, detail.detail_content ?? "", price);
}

// 상세페이지를 읽어와 title/description/detail_content를 채우고 구조화 태그를 붙인다.
// 우선순위 체인: ① Bright Data(공개 데이터 크롤러, 공개 URL 담당) → ② 데모 시드 데이터.
// 둘 다 안 되면(실제 서비스에서 Bright Data가 그 사이트를 못 다루는 경우) NO_DETAIL_SOURCE를
// 던진다 — 호출자는 이걸 받아 chrome_bridge로 직접 크롤링한 뒤 submitProductDetail()로
// 제출하도록 안내해야 한다 (GETTING_STARTED.md 플레이북 참고).
export async function enrichProductDetail(db: Database, productId: number): Promise<ProductWithTags> {
  const product = getProduct(db, productId);
  if (!product) throw new Error("NOT_FOUND");

  const detail = await resolveDetail(db, product);
  if (!detail) throw new Error("NO_DETAIL_SOURCE");

  const { tags } = await saveDetailAndTag(db, productId, product.last_price, detail);
  attachTags(db, productId, tags);

  return { ...(getProduct(db, productId) as Product), tags: getProductTags(db, productId) };
}

async function resolveDetail(db: Database, product: Product): Promise<DetailFields | null> {
  const useBrightData = process.env.MOCK_BRIGHTDATA !== "1" && Boolean(process.env.BRIGHTDATA_API_TOKEN);
  if (useBrightData) {
    try {
      return await fetchProductDetail(product.product_url);
    } catch {
      // Bright Data가 이 URL을 못 다루면(계정 zone 미설정, 사이트 차단 등) 데모/폴백으로 내려간다.
    }
  }

  const shop = getShop(db, product.shop_id);
  const demo = shop ? getDemoProductDetail(shop.name, product.product_url) : null;
  return demo ?? null;
}

// chrome_bridge 폴백 경로 — Bright Data/데모 둘 다 이 상품을 다루지 못할 때,
// AI 에이전트가 사용자의 브라우저로 직접 연 상세페이지 내용을 그대로 제출한다.
export async function submitProductDetail(
  db: Database,
  productId: number,
  detail: DetailFields,
): Promise<ProductWithTags> {
  const product = getProduct(db, productId);
  if (!product) throw new Error("NOT_FOUND");

  const { tags } = await saveDetailAndTag(db, productId, product.last_price, detail);
  attachTags(db, productId, tags);

  return { ...(getProduct(db, productId) as Product), tags: getProductTags(db, productId) };
}

// 구매내역 없이 "관심 상품"만 단독으로 카탈로그에 등록한다 — chrome_bridge로 둘러본
// 흥미로운 상품(예: 크림 트렌딩 목록)을 실제로 사지 않고도 그리드에 넣고 싶을 때 쓴다.
// findOrCreateProduct는 products 테이블만 건드리므로 purchase_count는 0으로 유지된다.
export async function discoverProduct(
  db: Database,
  shopId: number,
  input: {
    item_name: string;
    price: number;
    product_url: string;
    description?: string | null;
    detail_content?: string | null;
    image_url?: string | null;
  },
): Promise<ProductWithTags> {
  const shop = getShop(db, shopId);
  if (!shop) throw new Error("NOT_FOUND");

  const productId = findOrCreateProduct(db, shopId, {
    item_name: input.item_name,
    price: input.price,
    product_url: input.product_url,
  });

  if (input.description || input.detail_content) {
    return submitProductDetail(db, productId, {
      title: input.item_name,
      description: input.description ?? null,
      detail_content: input.detail_content ?? null,
      image_url: input.image_url ?? null,
    });
  }

  db.run(`UPDATE products SET title = COALESCE(title, ?), image_url = COALESCE(image_url, ?) WHERE id = ?`, [
    input.item_name,
    input.image_url ?? null,
    productId,
  ]);
  return { ...(getProduct(db, productId) as Product), tags: getProductTags(db, productId) };
}

export function attachTags(db: Database, productId: number, tags: ProductTag[]): void {
  const upsertTag = db.prepare(
    `INSERT INTO tags (name, category) VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET category = excluded.category`,
  );
  const findTag = db.prepare(`SELECT id FROM tags WHERE name = ?`);
  const linkTag = db.prepare(`INSERT OR IGNORE INTO product_tags (product_id, tag_id) VALUES (?, ?)`);

  for (const tag of tags) {
    upsertTag.run(tag.name, tag.category);
    const row = findTag.get(tag.name) as { id: number };
    linkTag.run(productId, row.id);
  }
}

export interface ProductQuery {
  shopId?: number;
  query?: string;
  personalized?: boolean;
}

export type ScoredProduct = ProductWithTags & { score: number };

// 그리드/탭 목록 + "나만을 위한" 검색을 겸한다.
// personalized(기본 true)면 상품 태그가 취향 프로필(interests)과 겹칠 때
// 점수를 올려서 개인화 정렬이 된다 — 태그가 구조화({name, category})되어 있어야
// 이 매칭이 의미를 가진다.
export function searchProducts(
  db: Database,
  opts: ProductQuery,
  interests: Interest[],
): ScoredProduct[] {
  let sql =
    "SELECT DISTINCT p.* FROM products p " +
    "LEFT JOIN product_tags pt ON pt.product_id = p.id " +
    "LEFT JOIN tags t ON t.id = pt.tag_id WHERE 1 = 1";
  const params: (string | number)[] = [];

  if (opts.shopId) {
    sql += " AND p.shop_id = ?";
    params.push(opts.shopId);
  }
  if (opts.query) {
    sql += " AND (p.title LIKE ? OR p.description LIKE ? OR t.name LIKE ?)";
    const like = `%${opts.query}%`;
    params.push(like, like, like);
  }

  const rows = db.query(sql).all(...params) as Product[];
  const personalized = opts.personalized !== false;

  const scored: ScoredProduct[] = rows.map((p) => {
    const tags = getProductTags(db, p.id);
    const textScore = scoreText(p, opts.query);
    const bonus = personalized ? personalizationBonus(tags, interests) : 0;
    return { ...p, tags, score: textScore + bonus };
  });

  scored.sort((a, b) => b.score - a.score || b.purchase_count - a.purchase_count);
  return scored;
}

function scoreText(product: Product, query?: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  if (product.title?.toLowerCase().includes(q)) return 10;
  if (product.description?.toLowerCase().includes(q)) return 5;
  return 1; // 태그로만 매칭된 경우
}

function personalizationBonus(tags: Tag[], interests: Interest[]): number {
  let bonus = 0;
  for (const tag of tags) {
    for (const interest of interests) {
      if (interest.tag.includes(tag.name) || tag.name.includes(interest.tag)) {
        bonus += interest.score;
      }
    }
  }
  return bonus;
}
