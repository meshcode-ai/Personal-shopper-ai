import type { Database } from "bun:sqlite";
import { findBetterPrice } from "../providers/priceSearch";
import { estimateOverseasCost } from "../providers/overseas";
import { categorize } from "./categories";
import { listDeals, scanForDeals } from "./deals";
import { getRecentSnapshots, recordPriceSnapshot } from "./priceSnapshots";
import { getProduct } from "./products";
import { formatUnitPrice } from "./unitPrice";

export interface Insight {
  id: number;
  kind: "hot_deal" | "monthly_saving" | "restock_reminder" | "watchlist_hit" | "overseas_arbitrage" | "price_timing";
  message: string;
  link_url: string | null;
  ref_type: "deal" | "product";
  ref_id: number;
  savings_pct: number | null;
  dismissed_at: string | null;
  created_at: string;
  updated_at: string;
}

// 아직 닫지 않은 인사이트만 상단 배너에 뿌린다.
export function listInsights(db: Database): Insight[] {
  return db
    .query("SELECT * FROM insights WHERE dismissed_at IS NULL ORDER BY created_at DESC")
    .all() as Insight[];
}

// "이해했으니 지운다" — 닫은 인사이트는 재스캔으로 내용이 갱신돼도
// (upsertInsight의 ON CONFLICT ... WHERE dismissed_at IS NULL 덕에) 다시 뜨지 않는다.
export function dismissInsight(db: Database, id: number): boolean {
  const result = db.run("UPDATE insights SET dismissed_at = datetime('now') WHERE id = ?", [id]);
  return result.changes > 0;
}

function upsertInsight(
  db: Database,
  input: { kind: string; refType: string; refId: number; message: string; linkUrl: string | null; savingsPct: number | null },
) {
  db.run(
    `INSERT INTO insights (kind, ref_type, ref_id, message, link_url, savings_pct)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, ref_type, ref_id) DO UPDATE SET
       message = excluded.message,
       link_url = excluded.link_url,
       savings_pct = excluded.savings_pct,
       updated_at = datetime('now')
     WHERE insights.dismissed_at IS NULL`,
    [input.kind, input.refType, input.refId, input.message, input.linkUrl, input.savingsPct],
  );
}

const HOT_DEAL_THRESHOLD_PCT = 15; // 이 이상 싸야 "핫딜"로 띄운다
const MONTHLY_SAVING_MIN_PCT = 5; // 이 이상 싸야 "매달 아낄 수 있어요" 문구를 붙인다
const RESCAN_STALE_HOURS = 24; // 이 시간 안에 갱신된 monthly_saving은 가격 API를 다시 안 부른다
const RESTOCK_DUE_RATIO = 0.8; // 평균 재구매 간격의 80% 이상 지나면 "슬슬 다시 살 때"로 본다
const OVERSEAS_MIN_PRICE_KRW = 30_000; // 이 아래면 배송비/통관 신경 쓸 값어치가 없다고 본다
const OVERSEAS_MIN_SAVING_PCT = 10; // 관/부가세·배송비까지 포함해서 이 이상 싸야 인사이트로 띄운다
const OVERSEAS_CATEGORIES = new Set(["fashion", "electronics", "beauty"]); // 식품/생필품은 무게·유통기한 때문에 직구 실익이 거의 없다
const PRICE_TIMING_MIN_SNAPSHOTS = 3; // 이만큼 스캔 기록이 쌓여야 "지금이 최저가"를 판단할 근거가 된다
const PRICE_TIMING_HIGH_RATIO = 1.08; // 평소 대비 이 배율 이상 비싸면 "지켜보세요"

// 상단 "쇼핑 어시스턴트" 배너에 뿌릴 인사이트를 만든다. 여섯 종류를 합친다:
//  ① 핫딜 — 구매내역 기반 딜 스캔(deals 테이블)에서 많이 싼 것만 문장으로 포맷
//  ② 매달 절약 — 재구매 패턴이 있는 상품을 다른 몰에서 사면 한 달에 얼마나
//     아낄 수 있는지 (최근 구매 빈도 × 가격차) 계산해서 문장으로 만든다
//  ③ 재구매 리마인더 — 외부 호출 없이 순수 구매 이력의 시간 간격만 보고
//     "슬슬 떨어질 때 됐다"를 알려준다 (생수/커피믹스처럼 소모품에서만 자연히 발동)
//  ④ 워치리스트 — 사용자가 등록한 목표가 이하로 딜이 잡히면 알려준다
//  ⑤ 해외직구 실익 — 배송비/관·부가세 추정치까지 반영해도 남는 차익이 있으면 알려준다
//  ⑥ 가격 타이밍 — 같은 상품을 여러 번 스캔해 쌓인 가격 이력을 보고
//     "지금이 최근 중 최저가"인지 "요즘 비싸니 기다려도 좋다"인지 조언한다
export async function generateInsights(db: Database, limit = 10): Promise<Insight[]> {
  await generateHotDealInsights(db, limit);
  await generateMonthlySavingInsights(db, limit);
  generateRestockInsights(db, limit);
  await generateWatchlistInsights(db, limit);
  await generateOverseasInsights(db, limit);
  generatePriceTimingInsights(db, limit);
  return listInsights(db);
}

// 소모품 재구매 시점 예측 — 평균 구매 간격 대비 마지막 구매 후 얼마나 지났는지만
// 계산한다. DB에 이미 있는 bought_at만 쓰므로 외부 API 호출이 전혀 없어
// 요청마다 부담 없이 돌릴 수 있다. 전자기기/의류처럼 간격이 불규칙한 상품은
// daysSinceLast/avgInterval 비율이 낮게 나와 자연히 걸러진다.
function generateRestockInsights(db: Database, limit: number) {
  const candidates = db
    .query(
      `SELECT id, title, product_url FROM products
       WHERE purchase_count >= 2 AND title IS NOT NULL
       ORDER BY purchase_count DESC LIMIT ?`,
    )
    .all(limit) as { id: number; title: string; product_url: string }[];

  for (const product of candidates) {
    const dates = (
      db
        .query(`SELECT bought_at FROM purchases WHERE product_id = ? AND bought_at IS NOT NULL ORDER BY bought_at ASC`)
        .all(product.id) as { bought_at: string }[]
    ).map((r) => r.bought_at);
    if (dates.length < 2) continue;

    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      gaps.push((new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / 86_400_000);
    }
    const avgIntervalDays = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (avgIntervalDays <= 0) continue;

    const daysSinceLast = (Date.now() - new Date(dates[dates.length - 1]).getTime()) / 86_400_000;
    if (daysSinceLast < avgIntervalDays * RESTOCK_DUE_RATIO) continue; // 아직 멀었다

    const overdue = daysSinceLast >= avgIntervalDays;
    const message = overdue
      ? `⏰ ${product.title}, 보통 ${Math.round(avgIntervalDays)}일마다 사시는데 마지막 구매 후 ${Math.round(daysSinceLast)}일 지났어요. 다 떨어졌을 시점이에요`
      : `⏰ ${product.title}, 보통 ${Math.round(avgIntervalDays)}일마다 재구매하시네요 — 슬슬 다시 살 때예요 (마지막 구매 ${Math.round(daysSinceLast)}일 전)`;

    upsertInsight(db, {
      kind: "restock_reminder",
      refType: "product",
      refId: product.id,
      message,
      linkUrl: product.product_url,
      savingsPct: null,
    });
  }
}

async function generateHotDealInsights(db: Database, limit: number) {
  await scanForDeals(db, limit); // 아직 안 찾아본 구매내역이 있으면 deals 테이블부터 채운다
  const deals = listDeals(db).filter((d) => d.savings_pct >= HOT_DEAL_THRESHOLD_PCT);
  for (const deal of deals) {
    // "24개입"처럼 개수가 상품명에 있으면 총액 옆에 단위가도 같이 보여준다 —
    // 총액만 봐서는 실제로 더 싼 건지 판단하기 어려운 대용량 상품에서 특히 유용하다.
    const unitNote = formatUnitPrice(deal.found_price, deal.item_name);
    upsertInsight(db, {
      kind: "hot_deal",
      refType: "deal",
      refId: deal.id,
      message: `🔥 ${deal.item_name}, ${deal.found_shop}에서 사면 ${deal.savings_pct}% 더 싸요 (${deal.found_price.toLocaleString()}원${unitNote ? `, ${unitNote}` : ""})`,
      linkUrl: deal.found_url,
      savingsPct: deal.savings_pct,
    });
  }
}

async function generateMonthlySavingInsights(db: Database, limit: number) {
  // 재구매 패턴이 뚜렷한(2번 이상 산) 상품 위주로, 최근 갱신된 건 건너뛴다 —
  // 매 스캔마다 가격 API를 다시 부르지 않기 위함.
  const candidates = db
    .query(
      `SELECT p.id, p.title, p.last_price FROM products p
       LEFT JOIN insights i ON i.kind = 'monthly_saving' AND i.ref_type = 'product' AND i.ref_id = p.id
       WHERE p.purchase_count >= 2 AND p.title IS NOT NULL
         AND (i.updated_at IS NULL OR i.updated_at < datetime('now', ?))
       ORDER BY p.purchase_count DESC
       LIMIT ?`,
    )
    .all(`-${RESCAN_STALE_HOURS} hours`, limit) as { id: number; title: string; last_price: number | null }[];

  for (const product of candidates) {
    if (product.last_price == null) continue;

    const stats = db
      .query(
        `SELECT COUNT(*) AS cnt, MIN(bought_at) AS first_at, MAX(bought_at) AS last_at, SUM(quantity) AS total_qty
         FROM purchases WHERE product_id = ?`,
      )
      .get(product.id) as { cnt: number; first_at: string | null; last_at: string | null; total_qty: number | null };
    if (stats.cnt < 2) continue;

    const result = await findBetterPrice(product.title, product.last_price);
    recordPriceSnapshot(db, product.id, result.found_shop, result.found_price); // 가격 타이밍 조언용 이력 적재
    if (result.savings_pct < MONTHLY_SAVING_MIN_PCT) continue;

    const months = monthsBetween(stats.first_at, stats.last_at);
    const monthlyQty = Math.max(1, Math.round((stats.total_qty ?? stats.cnt) / months));
    const monthlySaving = Math.round((product.last_price - result.found_price) * monthlyQty);
    if (monthlySaving <= 0) continue;

    const unitNote = formatUnitPrice(result.found_price, product.title);
    upsertInsight(db, {
      kind: "monthly_saving",
      refType: "product",
      refId: product.id,
      message: `🔁 최근 ${stats.cnt}번 산 ${product.title}, ${result.found_shop}에서 사면 매달 약 ${monthlySaving.toLocaleString()}원 아낄 수 있어요${unitNote ? ` (${unitNote})` : ""}`,
      linkUrl: result.found_url,
      savingsPct: result.savings_pct,
    });
  }
}

function monthsBetween(firstAt: string | null, lastAt: string | null): number {
  if (!firstAt || !lastAt) return 1;
  const days = (new Date(lastAt).getTime() - new Date(firstAt).getTime()) / 86_400_000;
  return Math.max(1, days / 30);
}

// 워치리스트 — 사용자가 target_price를 등록한 상품만 대상으로, 지금 다른 몰
// 최저가가 목표가 이하로 내려왔는지 확인한다. 참고가로는 last_price(마지막 구매가)를
// 쓴다 — 목표가 자체를 findBetterPrice에 넘기면 "목표가의 85%"라는 엉뚱한 값이
// 나오기 때문이다.
async function generateWatchlistInsights(db: Database, limit: number): Promise<void> {
  const candidates = db
    .query(
      `SELECT id, title, last_price, target_price FROM products
       WHERE target_price IS NOT NULL AND title IS NOT NULL AND last_price IS NOT NULL
       LIMIT ?`,
    )
    .all(limit) as { id: number; title: string; last_price: number; target_price: number }[];

  for (const product of candidates) {
    const result = await findBetterPrice(product.title, product.last_price);
    recordPriceSnapshot(db, product.id, result.found_shop, result.found_price);
    if (result.found_price > product.target_price) continue;

    upsertInsight(db, {
      kind: "watchlist_hit",
      refType: "product",
      refId: product.id,
      message: `🎯 목표가 ${product.target_price.toLocaleString()}원 이하로 등록하신 ${product.title}, 지금 ${result.found_shop}에서 ${result.found_price.toLocaleString()}원에 살 수 있어요!`,
      linkUrl: result.found_url,
      savingsPct: result.savings_pct,
    });
  }
}

// 해외직구 실익 — 배송비 + 관/부가세(추정)까지 다 더해도 남는 차익이 있을 때만
// 띄운다. 무겁거나 유통기한이 있는 식품/생필품은 대상에서 제외한다(직구 실익이
// 거의 없거나 통관이 까다롭다).
async function generateOverseasInsights(db: Database, limit: number): Promise<void> {
  const candidates = db
    .query(
      `SELECT id, title, last_price FROM products
       WHERE title IS NOT NULL AND last_price >= ?
       ORDER BY purchase_count DESC LIMIT ?`,
    )
    .all(OVERSEAS_MIN_PRICE_KRW, limit) as { id: number; title: string; last_price: number }[];

  for (const product of candidates) {
    if (!OVERSEAS_CATEGORIES.has(categorize(product.title).id)) continue;

    const quote = await estimateOverseasCost(product.title, product.last_price);
    const savingsPct = Math.round(((product.last_price - quote.total_landed_krw) / product.last_price) * 100);
    if (savingsPct < OVERSEAS_MIN_SAVING_PCT) continue;

    const feeNote = quote.duty_exempt ? "배송비 포함, 면세 한도 이내 추정" : "배송비 + 관/부가세 추정 포함";
    upsertInsight(db, {
      kind: "overseas_arbitrage",
      refType: "product",
      refId: product.id,
      message: `🌏 ${product.title}, 해외직구(AliExpress 추정)로 사면 ${feeNote} 약 ${quote.total_landed_krw.toLocaleString()}원 — 지금보다 ${savingsPct}% 쌀 수 있어요 (관세율은 품목마다 달라 추정치예요)`,
      linkUrl: quote.url,
      savingsPct,
    });
  }
}

// 가격 타이밍 — 스캔이 쌓일 때마다(monthly_saving/watchlist/"다른 쇼핑몰 찾기" 버튼)
// price_snapshots에 기록되는 이력을 보고, 지금이 최근 중 최저가인지 평소보다
// 비싼 시점인지를 조언한다. 외부 API 추가 호출 없이 이미 쌓인 이력만 본다.
function generatePriceTimingInsights(db: Database, limit: number): void {
  const candidates = db
    .query(
      `SELECT product_id, COUNT(*) AS cnt FROM price_snapshots
       GROUP BY product_id HAVING cnt >= ? LIMIT ?`,
    )
    .all(PRICE_TIMING_MIN_SNAPSHOTS, limit) as { product_id: number; cnt: number }[];

  for (const { product_id } of candidates) {
    const snapshots = getRecentSnapshots(db, product_id, 10); // 최신순
    const [latest, ...prior] = snapshots;
    if (!latest || prior.length === 0) continue;

    const product = getProduct(db, product_id);
    if (!product?.title) continue;

    const minPrior = Math.min(...prior.map((s) => s.price));
    const avgPrior = prior.reduce((sum, s) => sum + s.price, 0) / prior.length;

    if (latest.price <= minPrior) {
      upsertInsight(db, {
        kind: "price_timing",
        refType: "product",
        refId: product_id,
        message: `📉 ${product.title}, 최근 확인한 가격 중 지금이 가장 싸요 (${latest.shop_name} ${latest.price.toLocaleString()}원) — 사기 좋은 타이밍이에요`,
        linkUrl: null,
        savingsPct: null,
      });
    } else if (latest.price >= avgPrior * PRICE_TIMING_HIGH_RATIO) {
      upsertInsight(db, {
        kind: "price_timing",
        refType: "product",
        refId: product_id,
        message: `⏳ ${product.title}, 요즘 평소보다 비싸요 (${latest.shop_name} ${latest.price.toLocaleString()}원) — 급하지 않으면 좀 더 지켜보세요`,
        linkUrl: null,
        savingsPct: null,
      });
    }
  }
}
