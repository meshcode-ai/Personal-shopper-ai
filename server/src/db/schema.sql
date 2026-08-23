PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS shops (
  id                  INTEGER PRIMARY KEY,
  name                TEXT NOT NULL UNIQUE,
  base_url            TEXT NOT NULL,
  order_history_url   TEXT,
  logo_url            TEXT,           -- 탭에 보여줄 회사 로고/파비콘 URL
  credential_username TEXT,           -- 로그인 아이디. 비밀 아님 — 그대로 저장.
  credential_ref      TEXT,           -- OS 키체인 참조 키. 평문 비밀번호 절대 금지.
  parser_version      INTEGER DEFAULT 1,
  last_synced_at      TEXT,
  created_at          TEXT DEFAULT (datetime('now'))
);

-- 상품 카탈로그 — "내가 자주 사는 상품"의 단일 소스. 구매내역이 들어올 때마다
-- (shop_id, product_url) 기준으로 수렴되고, purchase_count가 누적된다.
CREATE TABLE IF NOT EXISTS products (
  id              INTEGER PRIMARY KEY,
  shop_id         INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_url     TEXT NOT NULL,
  title           TEXT,
  description     TEXT,
  detail_content  TEXT,               -- 상세페이지 크롤링 본문 (구조화 전 원문)
  image_url       TEXT,
  last_price      INTEGER,
  purchase_count  INTEGER DEFAULT 0,
  last_crawled_at TEXT,
  target_price    INTEGER,            -- 워치리스트 목표가. 이 값 이하로 딜이 잡히면 인사이트를 띄운다.
  created_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(shop_id, product_url)
);
CREATE INDEX IF NOT EXISTS idx_products_shop ON products(shop_id);

-- 태그는 항상 {name, category} 형태로 구조화된다 — "브랜드"/"카테고리"/"속성"/"가격대" 등.
CREATE TABLE IF NOT EXISTS tags (
  id       INTEGER PRIMARY KEY,
  name     TEXT NOT NULL UNIQUE,
  category TEXT
);

CREATE TABLE IF NOT EXISTS product_tags (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, tag_id)
);

CREATE TABLE IF NOT EXISTS purchases (
  id          INTEGER PRIMARY KEY,
  shop_id     INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
  item_name   TEXT NOT NULL,
  price       INTEGER,
  quantity    INTEGER DEFAULT 1,
  bought_at   TEXT,
  product_url TEXT,
  raw_json    TEXT,
  UNIQUE(shop_id, product_url, bought_at)
);
CREATE INDEX IF NOT EXISTS idx_purchases_shop ON purchases(shop_id);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(bought_at);
CREATE INDEX IF NOT EXISTS idx_purchases_product ON purchases(product_id);

CREATE TABLE IF NOT EXISTS interests (
  id         INTEGER PRIMARY KEY,
  tag        TEXT NOT NULL UNIQUE,
  score      REAL DEFAULT 0,
  evidence   TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deals (
  id          INTEGER PRIMARY KEY,
  purchase_id INTEGER REFERENCES purchases(id) ON DELETE CASCADE,
  found_shop  TEXT,
  found_price INTEGER,
  found_url   TEXT,
  savings_pct REAL,
  found_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deals_savings ON deals(savings_pct DESC);

-- 상단 "쇼핑 어시스턴트" 배너용 인사이트. deals와 달리 사람이 읽는 완성 문장을
-- 그대로 저장해서(예: "매달 X원 아낄 수 있어요"), 화면은 그냥 뿌리기만 하면 된다.
-- (kind, ref_type, ref_id) 유니크 — 같은 대상은 한 행만 유지하고 재스캔 때마다
-- 내용만 갱신한다. 사용자가 닫기를 누르면 dismissed_at이 박히고, 그 뒤로는
-- 재스캔이 내용을 갱신해도(ON CONFLICT ... WHERE dismissed_at IS NULL) 다시
-- 나타나지 않는다 — "이해하고 지우면 끝"이 되도록.
CREATE TABLE IF NOT EXISTS insights (
  id           INTEGER PRIMARY KEY,
  kind         TEXT NOT NULL,             -- 'hot_deal' | 'monthly_saving'
  message      TEXT NOT NULL,
  link_url     TEXT,
  ref_type     TEXT NOT NULL,             -- 'deal' | 'product'
  ref_id       INTEGER NOT NULL,
  savings_pct  REAL,
  dismissed_at TEXT,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(kind, ref_type, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_insights_active ON insights(dismissed_at, created_at DESC);

-- 가격 추이 스냅샷 — "다른 몰 찾기"/인사이트 스캔이 findBetterPrice를 부를 때마다
-- 한 줄씩 쌓는다. 스냅샷이 쌓이면 "최근 확인한 가격 중 최저가예요" 같은 타이밍
-- 조언(generatePriceTimingInsights)이 가능해진다. 정기 크론이 아니라 스캔이
-- 실제로 일어난 시점에만 쌓이므로, 자주 볼수록 더 정확해지는 구조다.
CREATE TABLE IF NOT EXISTS price_snapshots (
  id         INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  shop_name  TEXT NOT NULL,
  price      INTEGER NOT NULL,
  checked_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_price_snapshots_product ON price_snapshots(product_id, checked_at DESC);
