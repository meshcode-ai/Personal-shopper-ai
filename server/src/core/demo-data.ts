// 데모 시드 데이터(server/src/fixtures/demo-shops.json) 로더.
// purchases.ts와 products.ts 양쪽에서 쓰기 때문에 별도 모듈로 뺐다 —
// 두 파일이 서로를 import하는 순환 의존을 피하기 위함이다.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface OrderInput {
  item_name: string;
  price: number;
  quantity: number;
  bought_at: string;
  product_url: string;
}

export interface DemoProductDetail {
  title: string;
  description: string;
  detail_content: string;
  image_url: string;
}

interface DemoShopData {
  base_url: string;
  order_history_url: string;
  orders: OrderInput[];
  productDetails: Record<string, DemoProductDetail>;
}

let cache: Record<string, DemoShopData> | null = null;

function loadAll(): Record<string, DemoShopData> {
  if (!cache) {
    const fixturePath = join(import.meta.dir, "..", "fixtures", "demo-shops.json");
    cache = JSON.parse(readFileSync(fixturePath, "utf-8"));
  }
  return cache!;
}

// 지원하는 데모 샵 이름 그대로(쿠팡/네이버쇼핑/알리익스프레스/크림)와
// 정확히 일치할 때만 데이터를 준다 — 실서비스 판단은 core 쪽에서 한다.
export function getDemoShop(shopName: string): DemoShopData | null {
  return loadAll()[shopName] ?? null;
}

export function getDemoProductDetail(shopName: string, productUrl: string): DemoProductDetail | null {
  return loadAll()[shopName]?.productDetails?.[productUrl] ?? null;
}
