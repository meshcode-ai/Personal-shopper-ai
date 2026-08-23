import type { Database } from "bun:sqlite";
import { categorize } from "./categories";

export interface CategorySpend {
  category: string;
  label: string;
  current: number;
  previous: number;
  delta_pct: number | null; // 지난 구간이 0원이면 비율을 정의할 수 없어 null
}

export interface SpendingReport {
  window_days: number;
  current_range: [string, string];
  previous_range: [string, string];
  total_current: number;
  total_previous: number;
  categories: CategorySpend[];
}

const WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

// "이번 달 vs 지난달"을 오늘 날짜 기준으로 끊으면, 데모 데이터처럼 최근 구매가
// 없는 계정은 항상 0원만 보인다. 그래서 달력이 아니라 "가장 최근 구매일"을
// 기준으로 최근 30일 / 그 이전 30일을 비교한다 — 실사용자도 동기화를 며칠
// 걸러서 해도 리포트가 항상 의미 있는 값을 보여준다.
export function getSpendingReport(db: Database): SpendingReport {
  const rows = db
    .query(`SELECT item_name, price, quantity, bought_at FROM purchases WHERE bought_at IS NOT NULL`)
    .all() as { item_name: string; price: number | null; quantity: number | null; bought_at: string }[];

  if (rows.length === 0) {
    return { window_days: WINDOW_DAYS, current_range: ["", ""], previous_range: ["", ""], total_current: 0, total_previous: 0, categories: [] };
  }

  const latest = rows.reduce((max, r) => (r.bought_at > max ? r.bought_at : max), rows[0].bought_at);
  const anchor = new Date(latest).getTime();
  const currentStart = anchor - WINDOW_DAYS * DAY_MS;
  const previousStart = anchor - 2 * WINDOW_DAYS * DAY_MS;

  const byCategory = new Map<string, { label: string; current: number; previous: number }>();
  let totalCurrent = 0;
  let totalPrevious = 0;

  for (const r of rows) {
    const t = new Date(r.bought_at).getTime();
    const inCurrent = t > currentStart && t <= anchor;
    const inPrevious = t > previousStart && t <= currentStart;
    if (!inCurrent && !inPrevious) continue;

    const amount = (r.price ?? 0) * (r.quantity ?? 1);
    const { id, label } = categorize(r.item_name);
    const bucket = byCategory.get(id) ?? { label, current: 0, previous: 0 };
    if (inCurrent) {
      bucket.current += amount;
      totalCurrent += amount;
    } else {
      bucket.previous += amount;
      totalPrevious += amount;
    }
    byCategory.set(id, bucket);
  }

  const categories: CategorySpend[] = [...byCategory.entries()]
    .map(([category, { label, current, previous }]) => ({
      category,
      label,
      current,
      previous,
      delta_pct: previous > 0 ? Math.round(((current - previous) / previous) * 100) : null,
    }))
    .sort((a, b) => b.current - a.current);

  return {
    window_days: WINDOW_DAYS,
    current_range: [isoDate(currentStart + DAY_MS), isoDate(anchor)],
    previous_range: [isoDate(previousStart + DAY_MS), isoDate(currentStart)],
    total_current: totalCurrent,
    total_previous: totalPrevious,
    categories,
  };
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
