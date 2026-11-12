/**
 * MITUBEI 金額計算ロジック（画面・API 共通。外部依存なし）
 *
 * 浮動小数点の誤差を避けるため、すべて整数（BigInt）で計算する。
 *  - 数量：1/1000 単位の整数（quantityMilli）… 小数3桁まで
 *  - 単価：1/100 円単位の整数（unitPriceX100）… 小数2桁まで
 *  - 金額・税額：円単位の整数
 *
 * 消費税は「税率ごとに区分した合計額」に対して、見積書1通につき税率ごとに1回だけ端数処理する
 * （適格請求書等保存方式の端数処理ルールに合わせる）。明細ごとの税額は計算しない。
 */

export const QUANTITY_SCALE = 3;
export const PRICE_SCALE = 2;

/** 端数処理：切り捨て・四捨五入・切り上げ（いずれも絶対値に対して行い、符号を戻す） */
export type RoundingMode = "floor" | "round" | "ceil";
export const ROUNDING_LABELS: Record<RoundingMode, string> = {
  floor: "切り捨て",
  round: "四捨五入",
  ceil: "切り上げ",
};
export const ROUNDING_MODES: RoundingMode[] = ["floor", "round", "ceil"];

/** 税区分 */
export type TaxCategory = "standard" | "reduced" | "exempt";
export const TAX_CATEGORIES: TaxCategory[] = ["standard", "reduced", "exempt"];
export const TAX_RATE_PERCENT: Record<TaxCategory, number> = { standard: 10, reduced: 8, exempt: 0 };
export const TAX_CATEGORY_LABELS: Record<TaxCategory, string> = {
  standard: "10%",
  reduced: "8%（軽減）",
  exempt: "非課税",
};
/** PDF・集計表示用（「10%対象」など） */
export const TAX_GROUP_LABELS: Record<TaxCategory, string> = {
  standard: "10%対象",
  reduced: "8%対象（軽減税率）",
  exempt: "非課税",
};

/** 入力の上限（この範囲なら合計が Number.MAX_SAFE_INTEGER を超えない） */
export const MAX_QUANTITY_MILLI = 9_999_999_999n; // 9,999,999.999
export const MAX_UNIT_PRICE_X100 = 99_999_999_999n; // 999,999,999.99 円
export const MAX_LINE_AMOUNT = 999_999_999_999; // 1行 1兆円未満
export const MAX_ITEMS = 300;

/**
 * 10進数の文字列を、指定した小数桁数の整数に変換する。
 * 全角数字・カンマ・空白を許容。桁数を超える小数や不正な形式は null。
 */
export function parseDecimal(input: string, scale: number): bigint | null {
  const s = input
    .normalize("NFKC")
    .replace(/[,，\s]/g, "")
    .replace(/[−ー‐]/g, "-");
  if (s === "") return null;
  const m = /^(-)?(\d+)(?:\.(\d*))?$/.exec(s) ?? /^(-)?()\.(\d+)$/.exec(s);
  if (!m) return null;
  const [, sign, intPart = "", fracRaw = ""] = m;
  const frac = fracRaw.replace(/0+$/, "");
  if (frac.length > scale) return null;
  const digits = (intPart || "0") + frac.padEnd(scale, "0");
  if (digits.replace(/^0+/, "").length > 18) return null;
  const v = BigInt(digits);
  return sign && v !== 0n ? -v : v;
}

/** 整数（スケール付き）を 10進数の文字列に戻す（末尾の 0 は省く）。例：12500n, 3 → "12.5" */
export function formatDecimal(value: bigint, scale: number): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const base = 10n ** BigInt(scale);
  const intPart = abs / base;
  let frac = (abs % base).toString().padStart(scale, "0").replace(/0+$/, "");
  if (scale === 0) frac = "";
  return `${neg ? "-" : ""}${intPart.toString()}${frac ? "." + frac : ""}`;
}

/** n / d を端数処理して整数にする（d > 0） */
export function divRound(n: bigint, d: bigint, mode: RoundingMode): bigint {
  if (d <= 0n) throw new Error("divisor must be positive");
  const neg = n < 0n;
  const abs = neg ? -n : n;
  let q = abs / d;
  const r = abs % d;
  if (r !== 0n) {
    if (mode === "ceil") q += 1n;
    else if (mode === "round" && r * 2n >= d) q += 1n;
  }
  return neg ? -q : q;
}

/** 明細金額 = 数量 × 単価（円未満は企業設定の端数処理） */
export function lineAmount(quantityMilli: bigint, unitPriceX100: bigint, mode: RoundingMode): bigint {
  return divRound(quantityMilli * unitPriceX100, 10n ** BigInt(QUANTITY_SCALE + PRICE_SCALE), mode);
}

export type CalcLine = { amount: number; taxCategory: TaxCategory };

export type TaxGroup = {
  category: TaxCategory;
  rate: number;
  /** 値引き前の明細合計（税抜） */
  subtotal: number;
  /** この税率に配分した値引き額 */
  discount: number;
  /** 値引き後の対象額（税抜） */
  taxable: number;
  /** 消費税額（税率ごとに1回だけ端数処理） */
  tax: number;
};

export type EstimateTotals = {
  /** 明細合計（税抜・値引き前） */
  subtotal: number;
  discount: number;
  /** 値引き後の合計（税抜） */
  netTotal: number;
  tax: number;
  /** 税込合計 */
  total: number;
  /** 明細がある税率だけ（10% → 8% → 非課税 の順） */
  groups: TaxGroup[];
};

/**
 * 値引きを税率ごとの明細合計の比率で配分する（最大剰余法。配分の合計は必ず値引き額に一致）。
 * 値引きは税抜金額として扱う。
 */
export function allocateDiscount(subtotals: number[], discount: number): number[] {
  const weights = subtotals.map((s) => BigInt(Math.max(0, s)));
  const totalWeight = weights.reduce((a, b) => a + b, 0n);
  const d = BigInt(discount);
  if (d === 0n || totalWeight === 0n) return subtotals.map(() => 0);
  const base = weights.map((w) => (d * w) / totalWeight);
  let rest = d - base.reduce((a, b) => a + b, 0n);
  const order = weights
    .map((w, i) => ({ i, rem: (d * w) % totalWeight, w }))
    .sort((a, b) => (a.rem === b.rem ? (b.w > a.w ? 1 : b.w < a.w ? -1 : a.i - b.i) : b.rem > a.rem ? 1 : -1));
  for (const o of order) {
    if (rest <= 0n) break;
    if (weights[o.i] === 0n) continue;
    base[o.i] = base[o.i]! + 1n;
    rest -= 1n;
  }
  return base.map(Number);
}

export function computeTotals(lines: CalcLine[], discount: number, taxRounding: RoundingMode): EstimateTotals {
  const groups: TaxGroup[] = [];
  for (const category of TAX_CATEGORIES) {
    const inGroup = lines.filter((l) => l.taxCategory === category);
    if (inGroup.length === 0) continue;
    const subtotal = inGroup.reduce((a, l) => a + l.amount, 0);
    groups.push({ category, rate: TAX_RATE_PERCENT[category], subtotal, discount: 0, taxable: subtotal, tax: 0 });
  }
  const alloc = allocateDiscount(
    groups.map((g) => g.subtotal),
    discount,
  );
  for (const [i, g] of groups.entries()) {
    g.discount = alloc[i]!;
    g.taxable = g.subtotal - g.discount;
    g.tax = g.rate === 0 ? 0 : Number(divRound(BigInt(g.taxable) * BigInt(g.rate), 100n, taxRounding));
  }
  const subtotal = groups.reduce((a, g) => a + g.subtotal, 0);
  const netTotal = groups.reduce((a, g) => a + g.taxable, 0);
  const tax = groups.reduce((a, g) => a + g.tax, 0);
  return { subtotal, discount: subtotal - netTotal, netTotal, tax, total: netTotal + tax, groups };
}

/** 画面用：入力文字列から明細金額を計算（不正な入力は null） */
export function tryLineAmount(quantity: string, unitPrice: string, mode: RoundingMode): number | null {
  const q = parseDecimal(quantity, QUANTITY_SCALE);
  const p = parseDecimal(unitPrice, PRICE_SCALE);
  if (q === null || p === null) return null;
  if (q > MAX_QUANTITY_MILLI || q < -MAX_QUANTITY_MILLI || p > MAX_UNIT_PRICE_X100 || p < -MAX_UNIT_PRICE_X100) return null;
  const a = lineAmount(q, p, mode);
  if (a > BigInt(MAX_LINE_AMOUNT) || a < -BigInt(MAX_LINE_AMOUNT)) return null;
  return Number(a);
}

const yenFmt = new Intl.NumberFormat("ja-JP");
/** 1234567 → "1,234,567" */
export function formatYen(n: number): string {
  return yenFmt.format(n);
}

/** 単価・数量の表示用（整数部にカンマ、小数は必要な桁だけ） */
export function formatScaled(value: bigint, scale: number): string {
  const s = formatDecimal(value, scale);
  const [i = "0", f] = s.replace("-", "").split(".");
  return `${s.startsWith("-") ? "-" : ""}${yenFmt.format(BigInt(i))}${f ? "." + f : ""}`;
}
