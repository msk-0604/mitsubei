/**
 * 見積書番号の採番ルール（画面・API 共通）
 *  - 書式：接頭辞（{YYYY} {YY} {MM} を置換）＋ 連番（指定桁数でゼロ埋め）
 *  - 連番のリセット：毎年・毎月・なし
 * 既定：{YYYY}- / 4桁 / 毎年 → 2026-0001
 */
export type NumberReset = "yearly" | "monthly" | "never";
export const NUMBER_RESET_LABELS: Record<NumberReset, string> = {
  yearly: "毎年1から",
  monthly: "毎月1から",
  never: "リセットしない",
};

/** YYYY-MM-DD から連番の区切り（カウンターのキー）を作る */
export function numberPeriod(reset: NumberReset, ymd: string): string {
  if (reset === "yearly") return ymd.slice(0, 4);
  if (reset === "monthly") return ymd.slice(0, 7);
  return "all";
}

export function formatEstimateNumber(prefix: string, digits: number, seq: number, ymd: string): string {
  const head = prefix
    .replaceAll("{YYYY}", ymd.slice(0, 4))
    .replaceAll("{YY}", ymd.slice(2, 4))
    .replaceAll("{MM}", ymd.slice(5, 7));
  return head + String(seq).padStart(digits, "0");
}

/** 改訂版の番号：元の番号 + "-R1" "-R2" … */
export function revisionNumberLabel(baseNumber: string, revision: number): string {
  return `${baseNumber}-R${revision}`;
}

/** 日本時間の今日（YYYY-MM-DD） */
export function todayJst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
