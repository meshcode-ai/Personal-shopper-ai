# Architecture

## 설계 원칙

1. **데이터는 기기를 떠나지 않는다.** 구매내역·취향 메모리는 로컬 SQLite에만 존재한다.
   외부로 나가는 것은 가격 조회용 상품명과 익명화된 취향 요약뿐이다.
2. **로그인 벽은 뚫지 않고 우회한다.** 로그인이 필요하든 공개 데이터든, 전부 사용자 본인의
   실제 브라우저 세션(chrome_bridge)으로 직접 확인한다 — 별도 스크래핑 API로 우회하지 않는다.
3. **LLM이 만든 코드는 로컬에서 바로 실행하지 않는다.** 파서 자가수복은 Daytona 샌드박스에서만.
4. **자격증명은 DB에 없다.** OS 키체인에 두고 DB에는 참조 키만.

## 컴포넌트

### Sync Engine (`server/src/core/purchases.ts`)
chrome_bridge를 통해 사용자 브라우저를 조종한다. `importPurchases()`가 실데이터 경로이고,
`seedDemoPurchases()`는 데모 시드(4개 몰) 전용 대역이다. 둘 다 같은 `insertOrders()`
내부 헬퍼를 거치므로 upsert, raw_json 보존, 멱등성, 테스트는 경로에 상관없이 동일하다.

```
import_purchases(shop_id)                      ← 에이전트가 chrome_bridge로 직접 채워서 호출
  1. shops에서 order_history_url 조회 (credential_ref로 로그인 필요 여부 확인)
  2. (에이전트) chrome_bridge로 해당 URL 열기
  3. 로그인 상태 판정 (로그인 페이지로 리다이렉트되면 사용자에게 수동 로그인 요청)
  4. 주문 목록 DOM 읽기 → 페이지네이션 순회, 파서로 구조화
  5. (서버) orders 배열을 받아 findOrCreateProduct로 상품 카탈로그 upsert
     → purchases UPSERT (raw_json 함께 보존) → 신규 행일 때만 purchase_count++
  6. 파싱 실패율이 임계치를 넘으면 repair_parser 트리거

seedDemoPurchases(shop_id)                      ← chrome_bridge 미연결 시 데모 대역
  샵 이름이 데모 4종과 일치하면 demo-shops.json에서 같은 insertOrders()로 적재
```

`raw_json`을 항상 보존하는 이유: 파서를 개선했을 때 재스크래핑 없이 재파싱할 수 있다.
파서를 여러 번 고칠 상황이라면 이게 시간을 가장 많이 아껴준다.

### Product Enrichment (`server/src/core/products.ts`)
구매내역만으로는 상품명·가격만 있다. "자주 사는 상품"을 진짜로 이해하려면
상세페이지 본문과 구조화 태그가 필요하다 — 이게 개인화 검색의 재료가 된다.

```
submit_product_detail(product_id, detail, tags?) ← 기본 경로: chrome_bridge
  1. 에이전트가 chrome_bridge로 상세페이지를 직접 열어 읽는다
  2. title/description/detail_content/image_url 확보 → products UPDATE
  3. {name, category} 구조화 태그는 에이전트가 자기 LLM으로 직접 뽑아 tags로 함께 제출
     (category ∈ {브랜드, 카테고리, 속성, 가격대} — 자유 텍스트 아님)
     tags를 안 주면 서버가 mock 키워드 매칭으로 대충 채운다(정확도 낮음, 비권장)
  4. tags UPSERT + product_tags 연결

enrich_product(product_id)                      ← 선택적 지름길, 있으면만
  1. products에서 product_url 조회
  2. 서버에 등록된 보조 데이터 소스(예: 유료 스크래퍼 API)로 상세페이지 열기
     — 토큰 미설정/MOCK_BRIGHTDATA=1이면 스킵(기본값)
  3. 실패하면 데모 시드(demo-shops.json)에서 같은 product_url 조회
  4. 둘 다 없으면 NO_DETAIL_SOURCE — 호출자는 submit_product_detail로 직접 채워야 함
     (5~7단계는 submit_product_detail과 동일하게 처리)
```

### 개인화 검색 (`core/products.ts::searchProducts`)
```
score = textScore(title/description/tag 매칭) + personalizationBonus
personalizationBonus = Σ interest.score  (단, 상품 태그와 interest.tag가 서로 substring 매칭될 때)
```
`interests.tag`는 지금 구매한 상품명 자체다(`analyze_interests`가 채움) — 그래서 상품에
"커피"/"동서" 같은 태그가 붙어 있으면, 과거에 "동서 맥심 ... 커피믹스"를 산 적이 있는 사용자의
검색 결과에서 자연히 위로 올라온다. `personalized=0`으로 끄면 순수 텍스트/최신순.

### 자격증명 (`server/src/providers/keychain.ts`, `core/credentials.ts`)
```
set_shop_credential(shop_id, username, password)
  1. ref = "personal-shopper:shop:{shop_id}" 생성
  2. Keychain.setCredential(ref, password)  -- macOS: `security` CLI / 그 외: mock 파일
  3. shops.credential_username, credential_ref만 DB에 기록 (비밀번호 자체는 절대 X)
```
API 응답은 항상 `hasCredential: boolean`만 노출한다 — `credential_ref`도 내부 구현
디테일이라 클라이언트에 그대로 보내지 않는다 (`routes/shops.ts::serializeShop`).

### Parser Self-Repair (`server/src/providers/daytona.ts`)
쇼핑몰 DOM은 자주 바뀌고 파서는 깨진다.

```
repair_parser(shop_id)
  1. 실패한 raw_json 샘플 N건 수집
  2. Qwen에게 "이 HTML에서 상품명/가격/날짜를 뽑는 함수를 써라" 요청
  3. 생성된 코드를 Daytona 샌드박스에 업로드
  4. 샘플에 대해 실행 → 추출 정확도 측정
  5. 임계치 통과 시에만 로컬 파서로 승격, parser_version++
```

### Recommender (`server/src/providers/`)
```
analyze_interests()      purchases → 태그·재구매주기·가격민감도 → interests
                          (LLM 요약, 키 없으면 mock — server/src/providers/qwen.ts)
find_better_price(pid)   넛지 배너용 자동 스캔, 기본은 mock 가격 provider → deals
                          (대화 중 직접 가격 비교는 에이전트가 chrome_bridge로 확인)
```

## 데이터 흐름

```
Chrome (내 세션) ──scrape──> purchases ──┬──> products (카탈로그, purchase_count 누적)
                                          │        │
                                          │        └──chrome_bridge로 상세 확인──> tags
                                          │           (에이전트가 직접 {name,category} 추출)
                                          │                        │
                                          └──analyze──> interests ─┘
                                                            │        (겹치면 개인화 점수)
                                                            ▼
                                                    search_products ──> 그리드/탭 UI
purchases ──find_better_price(자동 스캔, mock 기본)──> deals ──> UI 추천 피드
       └──chrome_bridge로 직접 가격 비교(대화 중)──────────────────┘
```

**주문내역 스크랩 실패 대비**: `server/src/fixtures/demo-shops.json`에 4개 몰(쿠팡·네이버쇼핑·알리익스프레스·크림) 데모
시드를 미리 채워뒀다. 실제 chrome_bridge 스크랩이 실패해도 `POST /shops/:id/sync`로
즉시 데모 데이터로 넘어갈 수 있다.

## 데이터 소스 우선순위 요약

| 데이터 종류 | 1순위 | 폴백 | 이유 |
| --- | --- | --- | --- |
| 구매내역 (로그인 필요) | chrome_bridge (`/purchases/import`) | 데모 시드 (`/sync`) | 로그인 벽 안 → 공개 크롤러도 못 들어감, 에이전트가 직접 |
| 상품 상세/태그 (공개) | chrome_bridge (`/detail`) | enrich_product (`/enrich`, 보조 데이터 소스 설정 시만) | 개인 데이터와 똑같이 에이전트가 직접 보는 게 기본, 서버 보조 경로는 선택 사항 |

개인 데이터도 공개 데이터도 방향이 같다 — **둘 다 chrome_bridge가 1순위**다. 서버 보조 경로
(enrich_product / find_better_price)는 외부 API 키가 설정돼 있을 때만 도는 선택적 가속
수단일 뿐, 없어도(기본값) 전혀 문제없이 동작한다.

## 스코프 밖 (의도적으로 제외)

- 멀티 유저 / 계정 시스템 — 개인용 로컬 앱
- 클라우드 동기화 — 원칙 1과 충돌
- 티몬 · 위메프 — 2025~2026 기준 정상 영업 상태 아님
