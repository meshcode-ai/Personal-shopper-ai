// OpenAI/Qwen 호환 tool-calling 스키마 + 디스패처.
// 지금 라우트들은 core를 직접 호출하지만, 대화형 에이전트 루프(예: /api/chat)를
// 붙일 때는 이 TOOLS 배열을 그대로 LLM에 tools로 전달하고 dispatchTool로 실행하면 된다.
// 즉, "에이전트가 시스템 인스트럭션으로 샵 테이블을 동적으로 CRUD 관리"하는 설계의
// 실행부가 여기다.
import type { Database } from "bun:sqlite";
import * as CredentialsCore from "../core/credentials";
import * as DealsCore from "../core/deals";
import * as InterestsCore from "../core/interests";
import * as ProductsCore from "../core/products";
import * as PurchasesCore from "../core/purchases";
import * as ShopsCore from "../core/shops";

export const TOOLS = [
  {
    type: "function",
    function: {
      name: "add_shop",
      description: "새 쇼핑몰을 등록한다. 사용자가 몰 이름을 언급하면 즉시 호출한다.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          base_url: { type: "string" },
          order_history_url: { type: "string" },
        },
        required: ["name", "base_url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_shops",
      description: "등록된 쇼핑몰 목록을 반환한다.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "update_shop",
      description: "샵 정보를 수정한다 (주소, 주문내역 URL 등).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number" },
          base_url: { type: "string" },
          order_history_url: { type: "string" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_shop",
      description: "샵 등록을 해제한다. 연결된 구매내역도 함께 삭제된다.",
      parameters: {
        type: "object",
        properties: { id: { type: "number" } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "sync_purchase_history",
      description:
        "데모 시드 데이터를 가져온다. 샵 이름이 '쿠팡/네이버쇼핑/알리익스프레스/크림'과 " +
        "정확히 일치할 때만 동작한다. 실제 사용자 데이터는 import_purchases를 써라.",
      parameters: {
        type: "object",
        properties: { shop_id: { type: "number" } },
        required: ["shop_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "import_purchases",
      description:
        "chrome_bridge로 사용자의 이미 로그인된 브라우저에서 직접 스크랩한 주문내역을 " +
        "그대로 반영한다. 실서비스의 주 경로 — 사용자에게 새 로그인/비밀번호를 요구하지 않는다.",
      parameters: {
        type: "object",
        properties: {
          shop_id: { type: "number" },
          orders: {
            type: "array",
            items: {
              type: "object",
              properties: {
                item_name: { type: "string" },
                price: { type: "number" },
                quantity: { type: "number" },
                bought_at: { type: "string" },
                product_url: { type: "string" },
              },
              required: ["item_name", "price", "bought_at", "product_url"],
            },
          },
        },
        required: ["shop_id", "orders"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_interests",
      description: "모든 구매내역을 분석해 취향 프로필(PROFILE.md)을 갱신한다.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "find_better_price",
      description: "특정 구매 건에 대해 더 싼 곳이 있는지 찾는다.",
      parameters: {
        type: "object",
        properties: { purchase_id: { type: "number" } },
        required: ["purchase_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "scan_deals",
      description:
        "아직 딜을 찾아본 적 없는 구매내역을 한 번에 훑어 다른 쇼핑몰의 더 싼 가격을 찾는다 " +
        "(넛지 배너용 — 구매내역 하나하나에 find_better_price를 반복 호출할 필요 없이 한 번에 처리).",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", description: "한 번에 스캔할 최대 건수 (기본 20)" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_shop_credential",
      description:
        "샵 로그인 정보를 저장한다. 비밀번호는 OS 키체인에 저장되고 DB에는 참조 키만 남는다.",
      parameters: {
        type: "object",
        properties: {
          shop_id: { type: "number" },
          username: { type: "string" },
          password: { type: "string" },
        },
        required: ["shop_id", "username", "password"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_shop_credential",
      description: "저장된 샵 로그인 정보를 키체인에서 삭제한다.",
      parameters: {
        type: "object",
        properties: { shop_id: { type: "number" } },
        required: ["shop_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "enrich_product",
      description:
        "상품 상세페이지를 읽어와 설명을 채우고 구조화된 태그({name, category})를 붙인다. " +
        "Bright Data(공개 데이터 크롤러)를 먼저 시도하고, 실패하면 NO_DETAIL_SOURCE를 반환한다 — " +
        "이땐 chrome_bridge로 직접 열어 submit_product_detail로 제출해야 한다.",
      parameters: {
        type: "object",
        properties: { product_id: { type: "number" } },
        required: ["product_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_product_detail",
      description:
        "enrich_product가 NO_DETAIL_SOURCE를 반환했을 때 쓰는 폴백. chrome_bridge로 " +
        "직접 연 상세페이지 내용을 제출하면 서버가 동일하게 구조화 태그를 추출해 붙인다.",
      parameters: {
        type: "object",
        properties: {
          product_id: { type: "number" },
          title: { type: "string" },
          description: { type: "string" },
          detail_content: { type: "string" },
          image_url: { type: "string" },
        },
        required: ["product_id", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_products",
      description:
        "내 상품 카탈로그에서 검색한다. 개인화(취향 프로필 기반) 정렬이 기본이다.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          shop_id: { type: "number" },
          personalized: { type: "boolean" },
        },
      },
    },
  },
] as const;

export async function dispatchTool(db: Database, name: string, args: Record<string, any>) {
  switch (name) {
    case "add_shop":
      return ShopsCore.createShop(db, args as ShopsCore.CreateShopInput);
    case "list_shops":
      return ShopsCore.listShops(db);
    case "update_shop":
      return ShopsCore.updateShop(db, args.id, args);
    case "remove_shop":
      return { deleted: ShopsCore.deleteShop(db, args.id) };
    case "sync_purchase_history":
      return PurchasesCore.seedDemoPurchases(db, args.shop_id);
    case "import_purchases":
      return PurchasesCore.importPurchases(db, args.shop_id, args.orders);
    case "analyze_interests":
      return InterestsCore.runAnalysis(db);
    case "find_better_price":
      return DealsCore.findDealForPurchase(db, args.purchase_id);
    case "scan_deals":
      return DealsCore.scanForDeals(db, args.limit ?? 20);
    case "set_shop_credential":
      return CredentialsCore.setShopCredential(db, args.shop_id, args.username, args.password);
    case "remove_shop_credential":
      return CredentialsCore.removeShopCredential(db, args.shop_id);
    case "enrich_product":
      return ProductsCore.enrichProductDetail(db, args.product_id);
    case "submit_product_detail":
      return ProductsCore.submitProductDetail(db, args.product_id, {
        title: args.title,
        description: args.description ?? null,
        detail_content: args.detail_content ?? null,
        image_url: args.image_url ?? null,
      });
    case "search_products":
      return ProductsCore.searchProducts(
        db,
        { query: args.query, shopId: args.shop_id, personalized: args.personalized },
        InterestsCore.listInterests(db),
      );
    default:
      throw new Error(`알 수 없는 툴: ${name}`);
  }
}
