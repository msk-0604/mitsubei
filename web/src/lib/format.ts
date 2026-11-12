import { formatYen } from "../../../shared/calc";

const dateTimeFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** ISO 日時 → 2026/11/01 10:30 */
export function formatDateTime(iso: string): string {
  return dateTimeFmt.format(new Date(iso));
}

/** YYYY-MM-DD → 2026/11/01 */
export function formatYmd(ymd: string | null | undefined): string {
  return ymd ? ymd.replaceAll("-", "/") : "—";
}

/** YYYY-MM-DD → 2026年11月1日 */
export function formatYmdJa(ymd: string | null | undefined): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

export function yen(n: number): string {
  return `¥${formatYen(n)}`;
}

/** 数量・単価の表示（"12500.5" → "12,500.5"） */
export function formatNumberString(s: string): string {
  const neg = s.startsWith("-");
  const [i = "0", f] = s.replace("-", "").split(".");
  return `${neg ? "-" : ""}${Number(i).toLocaleString("ja-JP")}${f ? "." + f : ""}`;
}
