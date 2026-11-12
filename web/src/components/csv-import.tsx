"use client";

import { FileUp } from "lucide-react";
import { useState } from "react";
import { PRICE_SCALE, parseDecimal } from "../../../shared/calc";
import { ApiError, api, errorMessage } from "@/lib/api";
import { IMPORT_FIELDS, decodeCsv, guessMapping, parseCsv, type Encoding, type ImportField, type Mapping } from "@/lib/csv";
import { Alert, Button, Field, Modal, Select, useToast } from "./ui";

const MAX_FILE = 5 * 1024 * 1024;
const MAX_ROWS = 2000;

type Parsed = { fileName: string; buf: ArrayBuffer; encoding: Encoding; detected: "utf-8" | "shift_jis"; header: string[]; rows: string[][] };

/** CSV 一括登録：ファイル選択 → 文字コード・列の対応付けを確認 → 取り込み */
export function CsvImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [onDuplicate, setOnDuplicate] = useState<"overwrite" | "skip">("overwrite");
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Array<{ row: number; message: string }>>([]);
  const [busy, setBusy] = useState(false);

  function reset() {
    setParsed(null);
    setMapping(null);
    setError(null);
    setRowErrors([]);
  }
  function close() {
    if (busy) return;
    reset();
    onClose();
  }

  function load(fileName: string, buf: ArrayBuffer, encoding: Encoding) {
    const { text, encoding: detected } = decodeCsv(buf, encoding);
    const all = parseCsv(text);
    if (all.length < 2) {
      setError("データ行が見つかりません（1行目は見出し、2行目以降にデータを入れてください）");
      return;
    }
    const [header, ...rows] = all;
    setParsed({ fileName, buf, encoding, detected, header: header!, rows });
    setMapping(guessMapping(header!));
    setRowErrors([]);
    setError(rows.length > MAX_ROWS ? `一度に取り込めるのは${MAX_ROWS.toLocaleString()}行までです（${rows.length.toLocaleString()}行あります）。ファイルを分けてください` : null);
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    reset();
    if (file.size > MAX_FILE) return setError("ファイルが大きすぎます（5MBまで）");
    load(file.name, await file.arrayBuffer(), "auto");
  }

  const cell = (r: string[], f: ImportField) => (mapping && mapping[f] >= 0 ? (r[mapping[f]] ?? "").trim() : "");
  const missingRequired = IMPORT_FIELDS.filter((f) => "required" in f && f.required && (!mapping || mapping[f.key] < 0));

  // 画面での事前チェック（最終的な検証はサーバーで行う）
  const localErrors: Array<{ row: number; message: string }> = [];
  if (parsed && mapping && missingRequired.length === 0) {
    parsed.rows.forEach((r, i) => {
      if (!cell(r, "name")) localErrors.push({ row: i + 1, message: "商品名が空です" });
      else if (parseDecimal(cell(r, "unitPrice").replace(/[円¥￥]/g, ""), PRICE_SCALE) === null) {
        localErrors.push({ row: i + 1, message: `単価「${cell(r, "unitPrice").slice(0, 15)}」が数値ではありません` });
      }
    });
  }

  async function submit() {
    if (!parsed || !mapping) return;
    setBusy(true);
    setRowErrors([]);
    setError(null);
    try {
      const rows = parsed.rows.map((r) => ({
        code: cell(r, "code"),
        name: cell(r, "name"),
        category: cell(r, "category"),
        spec: cell(r, "spec"),
        unit: cell(r, "unit"),
        unitPrice: cell(r, "unitPrice"),
        taxCategory: cell(r, "taxCategory"),
        notes: cell(r, "notes"),
      }));
      const res = await api<{ created: number; updated: number; skipped: number; categoriesCreated: number }>("/price-items/import", {
        method: "POST",
        body: { onDuplicate, rows },
        label: "CSV一括登録",
      });
      toast("success", `取り込みました（新規 ${res.created}件・更新 ${res.updated}件・スキップ ${res.skipped}件）`);
      onDone();
      reset();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.details && typeof e.details === "object" && "rows" in e.details) {
        setRowErrors((e.details as { rows: Array<{ row: number; message: string }> }).rows);
      }
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const shownErrors = rowErrors.length > 0 ? rowErrors : localErrors;

  return (
    <Modal
      open={open}
      onClose={close}
      closeDisabled={busy}
      title="CSV一括登録"
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            キャンセル
          </Button>
          <Button
            onClick={submit}
            loading={busy}
            disabled={!parsed || missingRequired.length > 0 || localErrors.length > 0 || parsed.rows.length > MAX_ROWS}
          >
            {parsed ? `${parsed.rows.length.toLocaleString()}行を取り込む` : "取り込む"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!parsed && (
          <div className="space-y-3 text-sm text-slate-600">
            <p>1行目を見出し（列名）にした CSV ファイルを選んでください。Excel で保存した CSV（Shift_JIS）と UTF-8 のどちらにも対応しています。</p>
            <p className="text-xs text-slate-500">
              列の例：商品コード, 商品名, カテゴリ, 規格, 単位, 標準単価, 税区分（10% / 8% / 非課税）, 備考
              <br />
              商品コードが既存の商品と同じ行は、下の設定に従って上書き、またはスキップします。
            </p>
          </div>
        )}
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-6 text-center hover:border-blue-400 hover:bg-blue-50/40">
          <FileUp className="size-8 text-blue-600" aria-hidden />
          <span className="font-medium text-slate-700">{parsed ? parsed.fileName : "CSV ファイルを選択"}</span>
          <span className="text-xs text-slate-500">5MB・{MAX_ROWS.toLocaleString()}行まで</span>
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        </label>

        {error && <Alert>{error}</Alert>}

        {parsed && mapping && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="文字コード" htmlFor="csv-enc" hint={`自動判定：${parsed.detected === "utf-8" ? "UTF-8" : "Shift_JIS"}。文字化けする場合は変更してください`}>
                <Select id="csv-enc" value={parsed.encoding} onChange={(e) => load(parsed.fileName, parsed.buf, e.target.value as Encoding)}>
                  <option value="auto">自動</option>
                  <option value="utf-8">UTF-8</option>
                  <option value="shift_jis">Shift_JIS（Excel）</option>
                </Select>
              </Field>
              <Field label="商品コードが重複したとき" htmlFor="csv-dup">
                <Select id="csv-dup" value={onDuplicate} onChange={(e) => setOnDuplicate(e.target.value as "overwrite" | "skip")}>
                  <option value="overwrite">既存の商品を上書きする</option>
                  <option value="skip">スキップする（既存を残す）</option>
                </Select>
              </Field>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">列の対応付け</h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {IMPORT_FIELDS.map((f) => (
                  <label key={f.key} className="block text-xs text-slate-600">
                    {f.label}
                    {"required" in f && f.required && <span className="ml-1 text-red-600">*</span>}
                    <Select
                      value={mapping[f.key]}
                      onChange={(e) => setMapping({ ...mapping, [f.key]: Number(e.target.value) })}
                      className="mt-1 h-9 text-sm"
                    >
                      <option value={-1}>（取り込まない）</option>
                      {parsed.header.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `${i + 1}列目`}
                        </option>
                      ))}
                    </Select>
                  </label>
                ))}
              </div>
              {missingRequired.length > 0 && <p className="mt-2 text-sm text-red-600">「{missingRequired.map((f) => f.label).join("」「")}」の列を選んでください</p>}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">プレビュー（先頭5行）</h3>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[640px] text-xs">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-2 py-1.5">行</th>
                      {IMPORT_FIELDS.map((f) => (
                        <th key={f.key} className="px-2 py-1.5">
                          {f.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsed.rows.slice(0, 5).map((r, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1.5 text-slate-400">{i + 1}</td>
                        {IMPORT_FIELDS.map((f) => (
                          <td key={f.key} className="max-w-40 truncate px-2 py-1.5">
                            {cell(r, f.key)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {shownErrors.length > 0 && (
              <Alert>
                <p className="font-medium">{shownErrors.length}行に問題があります（行番号は見出しを除いたデータの行）</p>
                <ul className="mt-1 max-h-40 list-inside list-disc overflow-y-auto text-xs">
                  {shownErrors.slice(0, 100).map((e) => (
                    <li key={e.row}>
                      {e.row}行目：{e.message}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
