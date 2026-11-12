/** CSV の読み込み（文字コード判定・RFC 4180 形式の解析・列の自動対応付け） */

export type Encoding = "auto" | "utf-8" | "shift_jis";

/** UTF-8 として正しく読めれば UTF-8、読めなければ Shift_JIS（Excel の既定）として読む */
export function decodeCsv(buf: ArrayBuffer, encoding: Encoding): { text: string; encoding: "utf-8" | "shift_jis" } {
  const bytes = new Uint8Array(buf);
  if (encoding === "shift_jis") return { text: new TextDecoder("shift_jis").decode(bytes), encoding: "shift_jis" };
  if (encoding === "utf-8") return { text: new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, ""), encoding: "utf-8" };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, ""), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("shift_jis").decode(bytes), encoding: "shift_jis" };
  }
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // 空行を除く。書き出し時に付けた先頭の ' （数式対策）を外す
  return rows.filter((r) => r.some((c) => c.trim() !== "")).map((r) => r.map((c) => (/^'[=+\-@]/.test(c) ? c.slice(1) : c)));
}

export const IMPORT_FIELDS = [
  { key: "code", label: "商品コード", aliases: ["商品コード", "コード", "品番", "項目コード", "code"] },
  { key: "name", label: "商品名・工事項目名", aliases: ["商品名", "品名", "名称", "工事項目", "工事項目名", "項目名", "name"], required: true },
  { key: "category", label: "カテゴリ", aliases: ["カテゴリ", "カテゴリー", "分類", "category"] },
  { key: "spec", label: "規格・仕様", aliases: ["規格", "仕様", "規格・仕様", "型番", "spec"] },
  { key: "unit", label: "単位", aliases: ["単位", "unit"] },
  { key: "unitPrice", label: "標準単価", aliases: ["標準単価", "単価", "価格", "金額", "price", "unitprice"], required: true },
  { key: "taxCategory", label: "税区分", aliases: ["税区分", "税率", "消費税", "tax"] },
  { key: "notes", label: "備考", aliases: ["備考", "メモ", "notes"] },
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number]["key"];
export type Mapping = Record<ImportField, number>; // -1 = 取り込まない

export function guessMapping(header: string[]): Mapping {
  const norm = (s: string) => s.normalize("NFKC").replace(/[\s・()（）]/g, "").toLowerCase();
  const h = header.map(norm);
  const used = new Set<number>();
  const m = {} as Mapping;
  for (const f of IMPORT_FIELDS) {
    let idx = -1;
    for (const a of f.aliases) {
      const i = h.findIndex((x, j) => !used.has(j) && x === norm(a));
      if (i >= 0) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      for (const a of f.aliases) {
        const i = h.findIndex((x, j) => !used.has(j) && x.includes(norm(a)));
        if (i >= 0) {
          idx = i;
          break;
        }
      }
    }
    if (idx >= 0) used.add(idx);
    m[f.key] = idx;
  }
  return m;
}
