/** 金額計算・税額計算の単体テスト（画面と API で共通のロジック） */
import { describe, expect, it } from "vitest";
import {
  allocateDiscount,
  computeTotals,
  divRound,
  formatDecimal,
  lineAmount,
  parseDecimal,
  tryLineAmount,
} from "../../shared/calc";
import { formatEstimateNumber, numberPeriod, revisionNumberLabel, todayJst } from "../../shared/numbering";

describe("parseDecimal", () => {
  it("小数・カンマ・全角を整数に変換する", () => {
    expect(parseDecimal("12.5", 3)).toBe(12500n);
    expect(parseDecimal("1,800", 2)).toBe(180000n);
    expect(parseDecimal("１２．５", 3)).toBe(12500n);
    expect(parseDecimal(".5", 3)).toBe(500n);
    expect(parseDecimal("-3", 2)).toBe(-300n);
    expect(parseDecimal("1.500", 2)).toBe(150n); // 末尾の 0 は桁数に数えない
  });
  it("不正な入力・桁数超過は null", () => {
    expect(parseDecimal("", 2)).toBeNull();
    expect(parseDecimal("abc", 2)).toBeNull();
    expect(parseDecimal("1.234", 2)).toBeNull();
    expect(parseDecimal("1e5", 2)).toBeNull();
    expect(parseDecimal("1.2.3", 2)).toBeNull();
    expect(parseDecimal("9".repeat(30), 0)).toBeNull();
  });
  it("formatDecimal で元に戻る", () => {
    expect(formatDecimal(12500n, 3)).toBe("12.5");
    expect(formatDecimal(-150n, 2)).toBe("-1.5");
    expect(formatDecimal(180000n, 2)).toBe("1800");
  });
});

describe("端数処理", () => {
  it("切り捨て・四捨五入・切り上げ（負の数は絶対値で処理）", () => {
    expect(divRound(15n, 10n, "floor")).toBe(1n);
    expect(divRound(15n, 10n, "round")).toBe(2n);
    expect(divRound(14n, 10n, "round")).toBe(1n);
    expect(divRound(11n, 10n, "ceil")).toBe(2n);
    expect(divRound(10n, 10n, "ceil")).toBe(1n);
    expect(divRound(-15n, 10n, "floor")).toBe(-1n);
    expect(divRound(-15n, 10n, "round")).toBe(-2n);
  });
});

describe("明細金額（数量 × 単価）", () => {
  it("浮動小数点の誤差が出ない", () => {
    // JavaScript の number では 0.1 * 3 = 0.30000000000000004、1.15 * 100 = 114.99999999999999
    expect(lineAmount(parseDecimal("0.1", 3)!, parseDecimal("3", 2)!, "floor")).toBe(0n);
    expect(lineAmount(parseDecimal("3", 3)!, parseDecimal("0.1", 2)!, "round")).toBe(0n);
    expect(lineAmount(parseDecimal("1.15", 3)!, parseDecimal("100", 2)!, "floor")).toBe(115n);
    expect(lineAmount(parseDecimal("0.7", 3)!, parseDecimal("1000", 2)!, "floor")).toBe(700n);
    expect(lineAmount(parseDecimal("12.5", 3)!, parseDecimal("1800", 2)!, "floor")).toBe(22500n);
  });
  it("円未満を設定どおりに処理する", () => {
    expect(tryLineAmount("3", "150.5", "floor")).toBe(451);
    expect(tryLineAmount("3", "150.5", "round")).toBe(452);
    expect(tryLineAmount("3", "150.5", "ceil")).toBe(452);
    expect(tryLineAmount("0.333", "100", "round")).toBe(33);
  });
  it("大きな金額でも正確（Number の安全な範囲を超える中間値）", () => {
    // 9,999,999.999 × 99,999.99 = 10^12 − 10^5 − 100 + 0.00001 = 999,999,899,900.00001
    expect(tryLineAmount("9999999.999", "99999.99", "floor")).toBe(999999899900);
    expect(tryLineAmount("9999999.999", "999999999.99", "floor")).toBeNull(); // 1行の上限超過
  });
  it("不正な入力は null", () => {
    expect(tryLineAmount("abc", "100", "floor")).toBeNull();
    expect(tryLineAmount("1", "1.234", "floor")).toBeNull();
  });
});

describe("値引きの配分", () => {
  it("合計は必ず値引き額に一致する（最大剰余法）", () => {
    expect(allocateDiscount([22500, 451, 2500], 1000)).toEqual([884, 18, 98]);
    for (const d of [1, 7, 333, 1000, 25451]) {
      const a = allocateDiscount([22500, 451, 2500], d);
      expect(a.reduce((x, y) => x + y, 0)).toBe(d);
    }
    expect(allocateDiscount([100, 100, 100], 1)).toEqual([1, 0, 0]);
  });
  it("値引き0・対象0なら配分しない", () => {
    expect(allocateDiscount([100, 200], 0)).toEqual([0, 0]);
    expect(allocateDiscount([0, 0], 100)).toEqual([0, 0]);
  });
});

describe("消費税（税率ごとに1回だけ端数処理）", () => {
  it("明細ごとではなく、税率ごとの合計に対して計算する", () => {
    // 明細ごとに切り捨てると 3 × floor(99 × 0.1) = 27 円だが、正しくは floor(297 × 0.1) = 29 円
    const t = computeTotals(
      [
        { amount: 99, taxCategory: "standard" },
        { amount: 99, taxCategory: "standard" },
        { amount: 99, taxCategory: "standard" },
      ],
      0,
      "floor",
    );
    expect(t.tax).toBe(29);
    expect(t.total).toBe(326);
  });

  it("10%・8%・非課税の混在と値引き", () => {
    const t = computeTotals(
      [
        { amount: 22500, taxCategory: "standard" },
        { amount: 451, taxCategory: "reduced" },
        { amount: 2500, taxCategory: "exempt" },
      ],
      1000,
      "floor",
    );
    expect(t.subtotal).toBe(25451);
    expect(t.discount).toBe(1000);
    expect(t.groups).toEqual([
      { category: "standard", rate: 10, subtotal: 22500, discount: 884, taxable: 21616, tax: 2161 },
      { category: "reduced", rate: 8, subtotal: 451, discount: 18, taxable: 433, tax: 34 },
      { category: "exempt", rate: 0, subtotal: 2500, discount: 98, taxable: 2402, tax: 0 },
    ]);
    expect(t.tax).toBe(2195);
    expect(t.netTotal).toBe(24451);
    expect(t.total).toBe(26646);
  });

  it("端数処理の設定による違い", () => {
    const lines = [{ amount: 1005, taxCategory: "reduced" as const }]; // 1005 × 8% = 80.4
    expect(computeTotals(lines, 0, "floor").tax).toBe(80);
    expect(computeTotals(lines, 0, "round").tax).toBe(80);
    expect(computeTotals(lines, 0, "ceil").tax).toBe(81);
    const lines2 = [{ amount: 1005, taxCategory: "standard" as const }]; // 100.5
    expect(computeTotals(lines2, 0, "floor").tax).toBe(100);
    expect(computeTotals(lines2, 0, "round").tax).toBe(101);
  });

  it("値引き行（マイナス金額）を含む場合", () => {
    const t = computeTotals(
      [
        { amount: 10000, taxCategory: "standard" },
        { amount: -1000, taxCategory: "standard" },
      ],
      0,
      "floor",
    );
    expect(t.subtotal).toBe(9000);
    expect(t.tax).toBe(900);
    expect(t.total).toBe(9900);
  });

  it("明細なし", () => {
    expect(computeTotals([], 0, "floor")).toEqual({ subtotal: 0, discount: 0, netTotal: 0, tax: 0, total: 0, groups: [] });
  });
});

describe("見積書番号", () => {
  it("書式と区切り期間", () => {
    expect(formatEstimateNumber("{YYYY}-", 4, 1, "2026-11-12")).toBe("2026-0001");
    expect(formatEstimateNumber("Q{YY}{MM}-", 3, 12, "2026-04-01")).toBe("Q2604-012");
    expect(numberPeriod("yearly", "2026-11-12")).toBe("2026");
    expect(numberPeriod("monthly", "2026-11-12")).toBe("2026-11");
    expect(numberPeriod("never", "2026-11-12")).toBe("all");
    expect(revisionNumberLabel("2026-0001", 2)).toBe("2026-0001-R2");
  });
  it("日本時間の日付", () => {
    expect(todayJst(new Date("2026-12-31T15:30:00Z"))).toBe("2027-01-01");
    expect(todayJst(new Date("2026-12-31T14:59:00Z"))).toBe("2026-12-31");
  });
});
