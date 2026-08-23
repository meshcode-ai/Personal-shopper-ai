// 해외직구 실익 추정 — 관세청 목록통관 규정(자가사용 인정 시 미화 150달러,
// 미국발은 200달러 이하 면세)을 단순화해서 반영한다. 실제 관/부가세는 품목별
// 세율(HS 코드)마다 다르고 통관 방식에 따라서도 갈리므로 여기서는 정확한
// 세액이 아니라 "따져볼 가치가 있는지" 1차 감을 주는 게 목적이다 — 그래서
// 결과 문구엔 항상 "추정치"를 붙인다. 실제 서비스라면 관세사 API나 관세청
// 고시 세율표를 연동해야 한다.
export interface OverseasQuote {
  shop: string;
  price_local_usd: number;
  price_krw_before_fees: number;
  shipping_krw: number;
  duty_krw: number;
  total_landed_krw: number;
  duty_exempt: boolean;
  url: string;
}

const FX_KRW_PER_USD = Number(process.env.OVERSEAS_FX_KRW_PER_USD ?? 1350);
const DUTY_FREE_THRESHOLD_USD = 150; // 자가사용 목록통관 면세 한도(미국 외 기준)
const ESTIMATED_SHIPPING_KRW = 8_000;
const ESTIMATED_DUTY_RATE = 0.19; // 관세+부가세 합산 추정치 (품목별 실제 세율은 다를 수 있음)
const OVERSEAS_PRICE_FACTOR = 0.65; // 해외 리스팅가가 국내가 대비 대략 이 정도라고 가정 (mock)

export async function estimateOverseasCost(itemName: string, domesticPriceKrw: number): Promise<OverseasQuote> {
  const priceKrwBeforeFees = Math.round(domesticPriceKrw * OVERSEAS_PRICE_FACTOR);
  const priceLocalUsd = Math.round((priceKrwBeforeFees / FX_KRW_PER_USD) * 100) / 100;
  const dutyExempt = priceLocalUsd <= DUTY_FREE_THRESHOLD_USD;
  const duty = dutyExempt ? 0 : Math.round((priceKrwBeforeFees + ESTIMATED_SHIPPING_KRW) * ESTIMATED_DUTY_RATE);

  return {
    shop: "AliExpress",
    price_local_usd: priceLocalUsd,
    price_krw_before_fees: priceKrwBeforeFees,
    shipping_krw: ESTIMATED_SHIPPING_KRW,
    duty_krw: duty,
    total_landed_krw: priceKrwBeforeFees + ESTIMATED_SHIPPING_KRW + duty,
    duty_exempt: dutyExempt,
    url: `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(itemName)}`,
  };
}
