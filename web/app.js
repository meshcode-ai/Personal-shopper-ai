// 빌드 스텝 없는 바닐라 JS. 빠른 반복 개발에서는 이게 Vite 세팅보다 안전하다.
// 스타일은 Tailwind CDN(index.html의 <script src="https://cdn.tailwindcss.com">)으로 입힌다 —
// 별도 CSS 빌드 없이도 디자인 목업의 룩앤필을 그대로 가져올 수 있어서다.
const $ = (sel) => document.querySelector(sel);

let activeShopId = ""; // "" = 전체 탭
let searchQuery = "";

// --- 왼쪽 사이드바 카테고리 ---
// 태그 추출(Qwen/mock)이 아직 모든 상품을 커버하지 못해도 바로 쓸 수 있도록,
// 제목/태그 문자열에 키워드가 포함되는지로 클라이언트에서 분류한다 (서버 스키마 변경 없음).
// 카테고리 구성은 데모 구매내역(식품, 신발/의류, 뷰티가전, 전자액세서리)에 맞춰 골랐다.
const CATEGORIES = [
  { id: "", label: "전체", icon: "apps", keywords: [] },
  { id: "food", label: "식품·생필품", icon: "local_grocery_store", keywords: ["즉석밥", "커피", "생수", "라면", "김치", "우유", "과자", "음료", "시리얼", "견과"] },
  { id: "fashion", label: "패션·잡화", icon: "checkroom", keywords: ["나이키", "뉴발란스", "스투시", "런닝화", "신발", "후드", "티셔츠", "자켓", "가방", "덩크", "패딩"] },
  { id: "beauty", label: "뷰티", icon: "spa", keywords: ["샴푸", "에어랩", "트리트먼트", "화장품", "크림", "선크림", "클렌징", "향수", "바디워시"] },
  { id: "electronics", label: "전자기기", icon: "devices", keywords: ["충전", "스피커", "이어폰", "케이스", "공기청정기", "드라이기", "블루투스", "아이닉"] },
  { id: "home", label: "홈·리빙", icon: "chair", keywords: ["침구", "수납", "조명", "주방", "청소", "가전"] },
];
let activeCategoryId = "";

const TAB_ACTIVE = "flex items-center px-4 py-3 rounded-xl text-body-md font-body-md bg-primary-fixed text-on-primary-fixed-variant font-bold transition-all";
const TAB_INACTIVE = "flex items-center px-4 py-3 rounded-xl text-body-md font-body-md text-on-surface-variant hover:bg-surface-container-high transition-all";

function renderCategoryTabs() {
  $("#category-tabs").innerHTML = CATEGORIES.map(
    (c) => `
    <button class="${activeCategoryId === c.id ? TAB_ACTIVE : TAB_INACTIVE}" data-category="${c.id}">
      <span class="material-symbols-outlined mr-3">${c.icon}</span>${c.label}
    </button>`,
  ).join("");
}

function matchesCategory(product) {
  if (!activeCategoryId) return true;
  const category = CATEGORIES.find((c) => c.id === activeCategoryId);
  if (!category) return true;
  const haystack = `${product.title ?? ""} ${product.tags.map((t) => t.name).join(" ")}`;
  return category.keywords.some((kw) => haystack.includes(kw));
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = [data?.error, data?.hint].filter(Boolean).join("\n") || `${method} ${path} 실패 (${res.status})`;
    throw new Error(message);
  }
  return data;
}

// --- 쇼핑몰 탭 (왼쪽 사이드바) ---
async function loadShopTabs() {
  const shops = await api("GET", "/api/shops");
  const renderItem = (id, label, iconOrLogo) => {
    const cls = String(activeShopId) === String(id) ? TAB_ACTIVE : TAB_INACTIVE;
    const icon = iconOrLogo?.startsWith("http")
      ? `<img class="w-5 h-5 mr-3 rounded object-contain bg-white" src="${iconOrLogo}" alt="" />`
      : `<span class="material-symbols-outlined mr-3">${iconOrLogo ?? "storefront"}</span>`;
    return `<button class="${cls}" data-shop="${id}">${icon}${label}</button>`;
  };
  $("#shop-tabs").innerHTML = renderItem("", "전체", "apps") + shops.map((s) => renderItem(s.id, s.name, s.logo_url ?? "storefront")).join("");
  return shops;
}

// --- 상품 그리드 (탭 필터 + 카테고리 + 검색 + 개인화 정렬 겸용) ---
async function loadProductGrid() {
  const params = new URLSearchParams();
  if (activeShopId) params.set("shop_id", activeShopId);
  if (searchQuery) params.set("query", searchQuery);
  params.set("personalized", $("#personalized-toggle").checked ? "1" : "0");

  const products = (await api("GET", `/api/products?${params}`)).filter(matchesCategory);
  const grid = $("#product-grid");

  if (products.length === 0) {
    grid.innerHTML = `<p class="empty col-span-full text-on-surface-variant">상품이 없습니다. AI 에이전트에게 자주 쓰는 쇼핑몰을 알려주고 구매내역을 가져와 달라고 하세요.</p>`;
    return;
  }

  grid.innerHTML = products
    .map(
      (p) => `
    <article class="bg-surface-container-lowest rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-shadow duration-300 group flex flex-col h-full border border-outline-variant/10">
      <div class="relative h-48 w-full bg-surface-container flex items-center justify-center text-4xl overflow-hidden">
        ${p.image_url ? `<img class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" src="${p.image_url}" onerror="this.remove()" />` : "🛍️"}
        ${p.score > 0 ? `<span class="absolute top-4 left-4 bg-secondary text-white font-label-md text-label-md px-3 py-1 rounded-full shadow-md">맞춤 +${p.score}</span>` : ""}
      </div>
      <div class="p-6 flex flex-col flex-grow gap-4">
        <h3 class="font-headline-md text-headline-md text-on-surface line-clamp-2 leading-snug">${p.title ?? "(제목 미확인)"}</h3>
        <div class="flex items-center justify-between p-3 rounded-xl bg-surface-container-low">
          <span class="font-label-md text-label-md text-on-surface-variant">${p.purchase_count}회 구매</span>
          <span class="font-price-tag text-price-tag text-primary">${p.last_price != null ? p.last_price.toLocaleString() + "원" : "가격 미확인"}</span>
        </div>
        <div class="tag-row flex flex-wrap gap-1">
          ${p.tags.map((t) => `<span class="tag text-[11px] px-2.5 py-1 rounded-full border border-outline-variant/40 text-on-surface" data-category="${t.category}">${t.name}</span>`).join("")}
        </div>
        <div class="actions flex gap-2 mt-auto">
          <a class="flex-1 py-3 rounded-xl bg-primary text-on-primary text-center font-label-md text-label-md hover:scale-[1.02] transition-transform" href="${p.product_url}" target="_blank" rel="noopener">🛒 구매하기</a>
          <button class="flex-1 py-3 rounded-xl border border-primary text-primary font-label-md text-label-md hover:bg-primary-fixed transition-colors" data-action="find-deal" data-id="${p.id}">🔍 다른 쇼핑몰</button>
          <button
            class="w-11 rounded-xl border ${p.target_price != null ? "border-secondary text-secondary" : "border-outline-variant text-on-surface-variant"} hover:bg-surface-container-low transition-colors flex-shrink-0"
            data-action="watch" data-id="${p.id}" data-target="${p.target_price ?? ""}"
            title="${p.target_price != null ? `목표가 ${p.target_price.toLocaleString()}원 알림중 (클릭해서 변경/해제)` : "목표가 알림 설정"}"
          >🎯</button>
        </div>
        <div class="compare-result text-body-md" data-compare="${p.id}"></div>
      </div>
    </article>`,
    )
    .join("");
}

async function loadProfile() {
  const md = await fetch("/api/memory/profile").then((r) => r.text());
  $("#profile-view").textContent = md || "아직 분석된 프로필이 없습니다.";
}

async function loadDeals() {
  const deals = await api("GET", "/api/deals");
  const list = $("#deals-list");
  if (deals.length === 0) {
    list.innerHTML = `<p class="text-on-surface-variant">아직 찾은 딜이 없습니다.</p>`;
    return;
  }
  list.innerHTML = deals
    .map(
      (d) => `
    <div class="border border-outline-variant/30 rounded-xl p-4 flex flex-col gap-2">
      <div class="flex justify-between items-center gap-2">
        <span class="min-w-0" style="overflow-wrap:anywhere">
          ${d.item_name ? `<b>${d.item_name}</b>` : ""}
          ${d.shop_name ? `<span class="text-on-surface-variant text-sm ml-1">${d.shop_name} ${d.original_price?.toLocaleString() ?? "?"}원</span>` : ""}
        </span>
        <span class="text-secondary font-bold whitespace-nowrap">-${d.savings_pct}%</span>
      </div>
      <div class="flex justify-between items-center gap-2">
        <span>${d.found_shop}에서 <b>${d.found_price.toLocaleString()}원</b></span>
        <a class="text-primary font-bold whitespace-nowrap" href="${d.found_url}" target="_blank" rel="noopener">바로가기 →</a>
      </div>
    </div>`,
    )
    .join("");
}

// --- 지출 리포트 (최근 30일 vs 그 이전 30일, 카테고리별) ---
async function loadSpendingReport() {
  const report = await api("GET", "/api/spending/report");
  const rangeEl = $("#spending-range");
  const totalEl = $("#spending-total");
  const listEl = $("#spending-categories");

  if (report.categories.length === 0) {
    rangeEl.textContent = "";
    totalEl.innerHTML = "";
    listEl.innerHTML = `<p class="text-on-surface-variant">아직 비교할 만큼 구매내역이 쌓이지 않았어요.</p>`;
    return;
  }

  rangeEl.textContent = `최근 30일(${report.current_range[0]} ~ ${report.current_range[1]}) 기준, 그 이전 30일과 비교`;

  const totalDelta =
    report.total_previous > 0 ? Math.round(((report.total_current - report.total_previous) / report.total_previous) * 100) : null;
  totalEl.innerHTML = `
    <div class="flex items-baseline gap-2">
      <span class="font-price-tag text-price-tag text-primary">${report.total_current.toLocaleString()}원</span>
      ${
        totalDelta != null
          ? `<span class="${totalDelta > 0 ? "text-secondary" : "text-green-600"} font-bold text-sm">${totalDelta > 0 ? "▲" : "▼"} ${Math.abs(totalDelta)}%</span>`
          : ""
      }
    </div>`;

  listEl.innerHTML = report.categories
    .map(
      (c) => `
    <div class="flex items-center justify-between p-3 rounded-xl bg-surface-container-low">
      <span class="text-body-md">${c.label}</span>
      <span class="flex items-center gap-2">
        <b>${c.current.toLocaleString()}원</b>
        ${
          c.delta_pct != null
            ? `<span class="${c.delta_pct > 0 ? "text-secondary" : "text-green-600"} text-sm font-bold">${c.delta_pct > 0 ? "▲" : "▼"} ${Math.abs(c.delta_pct)}%</span>`
            : `<span class="text-on-surface-variant text-sm">신규</span>`
        }
      </span>
    </div>`,
    )
    .join("");
}

async function refreshAll() {
  await Promise.all([loadShopTabs(), loadProductGrid(), loadDeals(), loadSpendingReport()]);
}

// --- 쇼핑 어시스턴트 배너: 핫딜 + "매달 얼마 아낄 수 있어요" 인사이트 ---
// 사용자가 하나하나 확인할 필요 없이, 페이지가 뜨거나 구매내역이 새로 들어올
// 때마다 조용히 한 번씩 스캔해서 상단에 띄운다. 닫기는 DB에 dismissed_at으로
// 남겨서(서버: server/src/core/insights.ts) 새로고침해도, 재스캔해도 다시 안 뜬다.
async function scanAndRenderNudges() {
  try {
    renderNudgeBanner(await api("POST", "/api/insights/scan"));
  } catch (err) {
    // 인사이트는 있으면 좋고 실패해도 화면을 막을 정도는 아니다 — 조용히 넘어간다
    console.warn("인사이트 스캔 실패:", err.message);
    try {
      renderNudgeBanner(await api("GET", "/api/insights"));
    } catch {}
  }
}

function renderNudgeBanner(insights) {
  const box = $("#nudge-banner");
  const visible = insights.slice(0, 4);
  if (visible.length === 0) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = visible
    .map(
      (i) => `
    <div class="flex items-center justify-between gap-4 bg-secondary/10 border border-secondary/20 rounded-xl px-5 py-4 z-10" data-id="${i.id}">
      <span class="min-w-0" style="overflow-wrap:anywhere">
        ${i.message}
        ${i.link_url ? `<a class="text-primary font-bold ml-1" href="${i.link_url}" target="_blank" rel="noopener">바로가기 →</a>` : ""}
      </span>
      <button class="nudge-dismiss material-symbols-outlined text-on-surface-variant hover:text-on-surface flex-shrink-0" data-id="${i.id}" aria-label="닫기">close</button>
    </div>`,
    )
    .join("");
}

$("#nudge-banner").addEventListener("click", async (e) => {
  const btn = e.target.closest(".nudge-dismiss");
  if (!btn) return;
  const item = btn.closest("[data-id]");
  btn.disabled = true;
  try {
    await api("DELETE", `/api/insights/${btn.dataset.id}`);
    item?.remove();
  } catch (err) {
    btn.disabled = false;
    console.warn("인사이트 닫기 실패:", err.message);
  }
});

// --- 이벤트: 쇼핑몰 탭 ---
$("#shop-tabs").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-shop]");
  if (!btn) return;
  activeShopId = btn.dataset.shop;
  await Promise.all([loadShopTabs(), loadProductGrid()]);
});

// --- 이벤트: 카테고리 탭 ---
$("#category-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-category]");
  if (!btn) return;
  activeCategoryId = btn.dataset.category;
  renderCategoryTabs();
  loadProductGrid();
});

// --- 이벤트: 검색 + 개인화 토글 ---
// 입력할 때마다(백스페이스로 전부 지우는 것 포함) 바로 검색되게 한다 — 짧은 디바운스만 걸어서
// 타이핑 중 매 글자마다 요청이 나가는 건 막는다. 버튼 클릭/Enter는 디바운스 없이 즉시 반영.
let searchDebounceTimer;
$("#search-input").addEventListener("input", (e) => {
  searchQuery = e.target.value.trim();
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(loadProductGrid, 200);
});
$("#search-btn").addEventListener("click", () => {
  clearTimeout(searchDebounceTimer);
  searchQuery = $("#search-input").value.trim();
  loadProductGrid();
});
$("#search-input").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  clearTimeout(searchDebounceTimer);
  searchQuery = e.target.value.trim();
  loadProductGrid();
});
$("#personalized-toggle").addEventListener("change", loadProductGrid);

// --- 이벤트: 상품 그리드 (목표가 워치리스트 등록/해제) ---
$("#product-grid").addEventListener("click", async (e) => {
  const watchBtn = e.target.closest("button[data-action='watch']");
  if (!watchBtn) return;
  const current = watchBtn.dataset.target;
  const input = prompt(
    current
      ? `현재 목표가: ${Number(current).toLocaleString()}원\n새 목표가를 입력하세요 (해제하려면 빈 칸으로 확인).`
      : "이 가격 이하로 딜이 잡히면 알려드릴게요. 목표가를 입력하세요.",
    current || "",
  );
  if (input === null) return; // 취소
  const digits = input.replace(/[^0-9]/g, "");
  const targetPrice = digits === "" ? null : Number(digits);
  if (targetPrice !== null && targetPrice <= 0) {
    alert("올바른 숫자를 입력하세요.");
    return;
  }
  try {
    await api("PATCH", `/api/products/${watchBtn.dataset.id}/watch`, { target_price: targetPrice });
    await loadProductGrid();
  } catch (err) {
    alert(err.message);
  }
});

// --- 이벤트: 상품 그리드 (다른 쇼핑몰 가격 비교) ---
$("#product-grid").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action='find-deal']");
  if (!btn) return;
  const box = document.querySelector(`[data-compare="${btn.dataset.id}"]`);
  btn.disabled = true;
  btn.textContent = "찾는 중...";
  try {
    const deal = await api("POST", `/api/products/${btn.dataset.id}/find-deal`);
    const diff =
      deal.savings_pct > 0
        ? `<span class="text-green-600 font-bold">-${deal.savings_pct}%</span>`
        : deal.savings_pct < 0
          ? `<span class="text-secondary font-bold">+${Math.abs(deal.savings_pct)}%</span>`
          : `<span class="text-on-surface-variant font-bold">가격 동일</span>`;
    box.innerHTML = `
      <div class="flex justify-between items-center gap-2 pt-1">
        <span>${deal.found_shop} — <b>${deal.found_price.toLocaleString()}원</b> (원가 ${deal.original_price.toLocaleString()}원) ${diff}</span>
        <a class="text-primary font-bold whitespace-nowrap" href="${deal.found_url}" target="_blank" rel="noopener">바로가기 →</a>
      </div>`;
  } catch (err) {
    box.innerHTML = `<p class="text-on-surface-variant text-sm">${err.message}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "🔍 다른 쇼핑몰";
  }
});

// --- 이벤트: 취향 분석 ---
$("#analyze-btn").addEventListener("click", async () => {
  const btn = $("#analyze-btn");
  btn.disabled = true;
  btn.textContent = "분석 중...";
  try {
    await api("POST", "/api/analyze");
    await Promise.all([loadProfile(), loadProductGrid()]); // 개인화 점수가 바뀌므로 그리드도 갱신
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "🧠 취향 분석하기";
  }
});

renderCategoryTabs();
refreshAll();
loadProfile();
scanAndRenderNudges();
