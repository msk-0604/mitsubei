"use client";

import { ArrowDown, ArrowUp, BookUser, Eye, Plus, Save, Tags, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MAX_ITEMS,
  TAX_CATEGORIES,
  TAX_CATEGORY_LABELS,
  TAX_GROUP_LABELS,
  computeTotals,
  formatYen,
  parseDecimal,
  tryLineAmount,
  type RoundingMode,
  type TaxCategory,
} from "../../../shared/calc";
import { HONORIFICS, type Customer, type Estimate, type Honorific, type PriceItem } from "../../../shared/types";
import { ApiError, api, errorMessage } from "@/lib/api";
import { yen } from "@/lib/format";
import { CustomerPicker, PriceItemPicker } from "./pickers";
import { Alert, Button, Card, CardHeader, Field, Select, TextArea, TextInput, buttonClass, useToast } from "./ui";

type Row = {
  key: string;
  priceItemId: string | null;
  name: string;
  spec: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  taxCategory: TaxCategory;
  notes: string;
};

type Form = {
  estimateNumber: string;
  issueDate: string;
  validUntil: string;
  customerId: string | null;
  recipientName: string;
  recipientHonorific: Honorific;
  recipientContact: string;
  recipientAddress: string;
  subject: string;
  projectName: string;
  projectLocation: string;
  notes: string;
  discount: string;
};

export type EditorInitial = {
  estimate: Estimate | null;
  defaults: { estimateNumberPreview: string; issueDate: string; validUntil: string; notes: string | null; amountRounding: RoundingMode; taxRounding: RoundingMode };
};

let keySeq = 0;
const newKey = () => `r${++keySeq}`;
const emptyRow = (): Row => ({ key: newKey(), priceItemId: null, name: "", spec: "", quantity: "1", unit: "", unitPrice: "", taxCategory: "standard", notes: "" });
const isBlank = (r: Row) => !r.name.trim() && !r.unitPrice.trim() && !r.spec.trim();

function initialForm(init: EditorInitial): Form {
  const e = init.estimate;
  return {
    estimateNumber: e?.estimateNumber ?? "",
    issueDate: e?.issueDate ?? init.defaults.issueDate,
    validUntil: e ? (e.validUntil ?? "") : init.defaults.validUntil,
    customerId: e?.customerId ?? null,
    recipientName: e?.recipientName ?? "",
    recipientHonorific: e?.recipientHonorific ?? "御中",
    recipientContact: e?.recipientContact ?? "",
    recipientAddress: e?.recipientAddress ?? "",
    subject: e?.subject ?? "",
    projectName: e?.projectName ?? "",
    projectLocation: e?.projectLocation ?? "",
    notes: e ? (e.notes ?? "") : (init.defaults.notes ?? ""),
    discount: e && e.discount > 0 ? String(e.discount) : "",
  };
}

function initialRows(init: EditorInitial): Row[] {
  const items = init.estimate?.items ?? [];
  if (items.length === 0) return [emptyRow()];
  return items.map((it) => ({
    key: newKey(),
    priceItemId: it.priceItemId,
    name: it.name,
    spec: it.spec ?? "",
    quantity: it.quantity,
    unit: it.unit ?? "",
    unitPrice: it.unitPrice,
    taxCategory: it.taxCategory,
    notes: it.notes ?? "",
  }));
}

const numCls = "text-right tabular-nums";

export function EstimateEditor({ init }: { init: EditorInitial }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<Form>(() => initialForm(init));
  const [rows, setRows] = useState<Row[]>(() => initialRows(init));
  const [estimateId, setEstimateId] = useState<string | null>(init.estimate?.id ?? null);
  const [version, setVersion] = useState<number>(init.estimate?.version ?? 0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const rounding = { amount: init.estimate?.amountRounding ?? init.defaults.amountRounding, tax: init.estimate?.taxRounding ?? init.defaults.taxRounding };

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };
  const updateRow = (key: string, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  // 入力途中の内容が失われないよう、未保存のまま離れるときに確認する
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  /* ───── 金額計算（画面表示用。保存時はサーバーで同じロジックで再計算する） ───── */
  const amounts = useMemo(() => rows.map((r) => tryLineAmount(r.quantity || "0", r.unitPrice || "0", rounding.amount)), [rows, rounding.amount]);
  const discountValue = parseDecimal(form.discount || "0", 0);
  const totals = useMemo(() => {
    const lines = rows.map((r, i) => ({ amount: amounts[i] ?? 0, taxCategory: r.taxCategory })).filter((_, i) => !isBlank(rows[i]!));
    const d = discountValue !== null && discountValue >= 0n ? Number(discountValue) : 0;
    return computeTotals(lines, d, rounding.tax);
  }, [rows, amounts, discountValue, rounding.tax]);

  /* ───── 明細の操作 ───── */
  function addFromPrice(it: PriceItem) {
    setRows((rs) => {
      const row: Row = {
        key: newKey(),
        priceItemId: it.id,
        name: it.name,
        spec: it.spec ?? "",
        quantity: "1",
        unit: it.unit ?? "",
        unitPrice: it.unitPrice, // 追加した時点の単価を見積書に保存する
        taxCategory: it.taxCategory,
        notes: "",
      };
      // 末尾の空行は置き換える
      const last = rs[rs.length - 1];
      return last && isBlank(last) ? [...rs.slice(0, -1), row] : [...rs, row];
    });
    setDirty(true);
  }
  function move(i: number, d: -1 | 1) {
    setRows((rs) => {
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
    setDirty(true);
  }

  function pickCustomer(c: Customer) {
    setForm((f) => ({
      ...f,
      customerId: c.id,
      recipientName: c.name,
      recipientHonorific: c.honorific,
      recipientContact: c.contactName ?? "",
      recipientAddress: [c.postalCode ? `〒${c.postalCode}` : "", c.address ?? ""].filter(Boolean).join(" "),
    }));
    setDirty(true);
  }

  /* ───── 保存 ───── */
  const save = useCallback(
    async (then?: "view") => {
      if (saving) return;
      setErrors({});
      setFormError(null);
      const kept = rows.filter((r) => !isBlank(r));
      const local: Record<string, string> = {};
      kept.forEach((r) => {
        const i = rows.indexOf(r);
        if (!r.name.trim()) local[`row.${r.key}.name`] = "品名を入力してください";
        if (amounts[i] === null) local[`row.${r.key}.unitPrice`] = "数量・単価を確認してください";
      });
      if (discountValue === null || discountValue < 0n) local.discount = "値引きは0以上の整数（円）で入力してください";
      if (Object.keys(local).length > 0) {
        setErrors(local);
        setFormError("入力内容を確認してください");
        return;
      }
      const body = {
        estimateNumber: form.estimateNumber.trim() || null,
        issueDate: form.issueDate,
        validUntil: form.validUntil || null,
        customerId: form.customerId,
        recipientName: form.recipientName,
        recipientHonorific: form.recipientHonorific,
        recipientContact: form.recipientContact,
        recipientAddress: form.recipientAddress,
        subject: form.subject,
        projectName: form.projectName,
        projectLocation: form.projectLocation,
        notes: form.notes,
        discount: Number(discountValue ?? 0n),
        items: kept.map((r) => ({
          priceItemId: r.priceItemId,
          name: r.name,
          spec: r.spec,
          quantity: r.quantity || "0",
          unit: r.unit,
          unitPrice: r.unitPrice || "0",
          taxCategory: r.taxCategory,
          notes: r.notes,
        })),
        ...(estimateId ? { version } : {}),
      };
      setSaving(true);
      try {
        const saved = await api<Estimate>(estimateId ? `/estimates/${estimateId}` : "/estimates", {
          method: estimateId ? "PUT" : "POST",
          body,
          label: "見積書の保存",
        });
        setVersion(saved.version);
        setForm((f) => ({ ...f, estimateNumber: saved.estimateNumber }));
        setDirty(false);
        toast("success", "保存しました");
        if (then === "view") router.push(`/estimates/${saved.id}`);
        else if (!estimateId) {
          setEstimateId(saved.id);
          // 以降は同じ見積書の更新になるよう URL を編集画面に切り替える（再読み込みはしない）
          window.history.replaceState(null, "", `/estimates/${saved.id}/edit`);
        }
      } catch (e) {
        if (e instanceof ApiError) {
          const fe: Record<string, string> = {};
          for (const [k, v] of Object.entries(e.fieldErrors)) {
            const m = /^items\.(\d+)\.(\w+)$/.exec(k);
            const row = m ? kept[Number(m[1])] : undefined;
            fe[row ? `row.${row.key}.${m![2]}` : k] = v;
          }
          setErrors(fe);
        }
        setFormError(errorMessage(e));
        toast("error", errorMessage(e));
      } finally {
        setSaving(false);
      }
    },
    [saving, rows, amounts, discountValue, form, estimateId, version, toast, router],
  );

  // Ctrl+S / ⌘+S で保存
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [save]);

  const err = (k: string) => errors[k];

  return (
    <div className="space-y-4 pb-24">
      {formError && <Alert>{formError}</Alert>}

      {/* ───── 基本情報 ───── */}
      <Card>
        <CardHeader title="基本情報" />
        <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-4">
          <Field label="見積書番号" htmlFor="estimateNumber" error={err("estimateNumber")} hint={estimateId ? undefined : `空欄で自動採番（${init.defaults.estimateNumberPreview}）`}>
            <TextInput
              id="estimateNumber"
              value={form.estimateNumber}
              onChange={(e) => set("estimateNumber", e.target.value)}
              placeholder={init.defaults.estimateNumberPreview}
              error={err("estimateNumber")}
            />
          </Field>
          <Field label="発行日" htmlFor="issueDate" required error={err("issueDate")}>
            <TextInput id="issueDate" type="date" value={form.issueDate} onChange={(e) => set("issueDate", e.target.value)} error={err("issueDate")} />
          </Field>
          <Field label="有効期限" htmlFor="validUntil" error={err("validUntil")}>
            <TextInput id="validUntil" type="date" value={form.validUntil} onChange={(e) => set("validUntil", e.target.value)} error={err("validUntil")} />
          </Field>
          <div className="hidden lg:block" />
          <div className="sm:col-span-2 lg:col-span-2">
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="recipientName" className="text-sm font-medium text-slate-700">
                宛先（会社名・顧客名）
              </label>
              <button type="button" onClick={() => setCustomerOpen(true)} className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline">
                <BookUser className="size-4" aria-hidden />
                顧客から選ぶ
              </button>
            </div>
            <div className="flex gap-2">
              <TextInput
                id="recipientName"
                value={form.recipientName}
                onChange={(e) => {
                  set("recipientName", e.target.value);
                }}
                error={err("recipientName")}
                placeholder="株式会社〇〇"
              />
              <Select
                value={form.recipientHonorific}
                onChange={(e) => set("recipientHonorific", e.target.value as Honorific)}
                className="w-24 shrink-0"
                aria-label="敬称"
              >
                {HONORIFICS.map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </Select>
            </div>
            {err("recipientName") && <p className="mt-1 text-sm text-red-600">{err("recipientName")}</p>}
          </div>
          <Field label="担当者名" htmlFor="recipientContact" className="lg:col-span-1">
            <TextInput id="recipientContact" value={form.recipientContact} onChange={(e) => set("recipientContact", e.target.value)} placeholder="〇〇 様" />
          </Field>
          <Field label="宛先住所" htmlFor="recipientAddress" className="lg:col-span-1">
            <TextInput id="recipientAddress" value={form.recipientAddress} onChange={(e) => set("recipientAddress", e.target.value)} />
          </Field>
          <Field label="件名" htmlFor="subject" error={err("subject")} className="sm:col-span-2">
            <TextInput id="subject" value={form.subject} onChange={(e) => set("subject", e.target.value)} error={err("subject")} placeholder="〇〇工事 御見積" />
          </Field>
          <Field label="工事名・案件名" htmlFor="projectName" className="sm:col-span-1">
            <TextInput id="projectName" value={form.projectName} onChange={(e) => set("projectName", e.target.value)} />
          </Field>
          <Field label="工事場所" htmlFor="projectLocation" className="sm:col-span-1">
            <TextInput id="projectLocation" value={form.projectLocation} onChange={(e) => set("projectLocation", e.target.value)} />
          </Field>
        </div>
      </Card>

      {/* ───── 明細 ───── */}
      <Card>
        <CardHeader
          title={`明細（${rows.filter((r) => !isBlank(r)).length}行）`}
          actions={
            <>
              <Button variant="primary" size="sm" onClick={() => setPickerOpen(true)}>
                <Tags className="size-4" aria-hidden />
                価格表から追加
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={rows.length >= MAX_ITEMS}
                onClick={() => {
                  setRows((rs) => [...rs, emptyRow()]);
                  setDirty(true);
                }}
              >
                <Plus className="size-4" aria-hidden />
                行を追加
              </Button>
            </>
          }
        />
        {err("items") && <p className="px-5 pt-3 text-sm text-red-600">{err("items")}</p>}
        <div className="hidden grid-cols-[2rem_minmax(0,1fr)_6.5rem_4.5rem_8rem_7rem_8rem_5.5rem] gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500 lg:grid">
          <span>#</span>
          <span>品名・工事項目 / 規格・仕様 / 備考</span>
          <span className="text-right">数量</span>
          <span>単位</span>
          <span className="text-right">単価（税抜）</span>
          <span>税区分</span>
          <span className="text-right">金額</span>
          <span />
        </div>
        <ol className="divide-y divide-slate-100">
          {rows.map((r, i) => {
            const amount = amounts[i];
            return (
              <li key={r.key} className="grid grid-cols-2 gap-2 px-4 py-3 lg:grid-cols-[2rem_minmax(0,1fr)_6.5rem_4.5rem_8rem_7rem_8rem_5.5rem] lg:items-start">
                <span className="col-span-2 flex items-center gap-2 text-xs font-medium text-slate-400 lg:col-span-1 lg:pt-3">
                  {i + 1}
                  {r.priceItemId && <span className="rounded bg-blue-50 px-1 text-[10px] text-blue-700 lg:hidden">価格表</span>}
                </span>
                <div className="col-span-2 space-y-1.5 lg:col-span-1">
                  <TextInput
                    value={r.name}
                    onChange={(e) => updateRow(r.key, { name: e.target.value })}
                    placeholder="品名・工事項目"
                    aria-label={`${i + 1}行目 品名`}
                    error={err(`row.${r.key}.name`)}
                  />
                  <div className="grid grid-cols-2 gap-1.5">
                    <TextInput
                      value={r.spec}
                      onChange={(e) => updateRow(r.key, { spec: e.target.value })}
                      placeholder="規格・仕様"
                      aria-label={`${i + 1}行目 規格・仕様`}
                      className="h-9 text-sm"
                    />
                    <TextInput
                      value={r.notes}
                      onChange={(e) => updateRow(r.key, { notes: e.target.value })}
                      placeholder="備考"
                      aria-label={`${i + 1}行目 備考`}
                      className="h-9 text-sm"
                    />
                  </div>
                  {err(`row.${r.key}.name`) && <p className="text-xs text-red-600">{err(`row.${r.key}.name`)}</p>}
                </div>
                <label className="block">
                  <span className="mb-1 block text-xs text-slate-500 lg:hidden">数量</span>
                  <TextInput
                    value={r.quantity}
                    inputMode="decimal"
                    onChange={(e) => updateRow(r.key, { quantity: e.target.value })}
                    onFocus={(e) => e.target.select()}
                    className={numCls}
                    aria-label={`${i + 1}行目 数量`}
                    error={err(`row.${r.key}.quantity`)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-slate-500 lg:hidden">単位</span>
                  <TextInput value={r.unit} onChange={(e) => updateRow(r.key, { unit: e.target.value })} aria-label={`${i + 1}行目 単位`} placeholder="式" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-slate-500 lg:hidden">単価（税抜）</span>
                  <TextInput
                    value={r.unitPrice}
                    inputMode="decimal"
                    onChange={(e) => updateRow(r.key, { unitPrice: e.target.value })}
                    onFocus={(e) => e.target.select()}
                    className={numCls}
                    aria-label={`${i + 1}行目 単価`}
                    placeholder="0"
                    error={err(`row.${r.key}.unitPrice`)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-slate-500 lg:hidden">税区分</span>
                  <Select value={r.taxCategory} onChange={(e) => updateRow(r.key, { taxCategory: e.target.value as TaxCategory })} aria-label={`${i + 1}行目 税区分`}>
                    {TAX_CATEGORIES.map((t) => (
                      <option key={t} value={t}>
                        {TAX_CATEGORY_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                </label>
                <div className="col-span-2 flex items-center justify-between lg:col-span-1 lg:block lg:pt-2.5 lg:text-right">
                  <span className="text-xs text-slate-500 lg:hidden">金額</span>
                  <span className={`font-semibold tabular-nums ${amount === null ? "text-red-600" : "text-slate-800"}`}>
                    {amount === null ? "入力を確認" : `${formatYen(amount)}円`}
                  </span>
                  {err(`row.${r.key}.unitPrice`) && <p className="text-xs text-red-600">{err(`row.${r.key}.unitPrice`)}</p>}
                </div>
                <div className="col-span-2 flex justify-end gap-0.5 lg:col-span-1 lg:pt-1">
                  <Button variant="ghost" size="sm" className="px-2" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${i + 1}行目を上へ`}>
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="px-2" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={`${i + 1}行目を下へ`}>
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="px-2 text-red-600 hover:bg-red-50"
                    onClick={() => {
                      setRows((rs) => (rs.length === 1 ? [emptyRow()] : rs.filter((x) => x.key !== r.key)));
                      setDirty(true);
                    }}
                    aria-label={`${i + 1}行目を削除`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
          <Button variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
            <Tags className="size-4" aria-hidden />
            価格表から追加
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={rows.length >= MAX_ITEMS}
            onClick={() => {
              setRows((rs) => [...rs, emptyRow()]);
              setDirty(true);
            }}
          >
            <Plus className="size-4" aria-hidden />
            直接入力する行を追加
          </Button>
        </div>
      </Card>

      {/* ───── 合計・備考 ───── */}
      <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <Card>
          <CardHeader title="備考" />
          <div className="p-4 sm:p-5">
            <TextArea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={5} aria-label="備考" placeholder="支払条件、工期、注意事項など" />
          </div>
        </Card>
        <Card>
          <CardHeader title="合計" description={`端数処理：金額・税額とも企業設定に従います`} />
          <dl className="space-y-2 p-4 text-sm sm:p-5">
            <div className="flex justify-between">
              <dt className="text-slate-600">小計（税抜）</dt>
              <dd className="tabular-nums">{yen(totals.subtotal)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-600">
                <label htmlFor="discount">値引き（税抜）</label>
              </dt>
              <dd className="w-36">
                <TextInput
                  id="discount"
                  value={form.discount}
                  inputMode="numeric"
                  onChange={(e) => set("discount", e.target.value)}
                  className={`h-9 ${numCls}`}
                  placeholder="0"
                  error={err("discount")}
                />
              </dd>
            </div>
            {err("discount") && <p className="text-right text-xs text-red-600">{err("discount")}</p>}
            {totals.groups.map((g) => (
              <div key={g.category} className="flex justify-between text-xs text-slate-500">
                <dt>
                  {TAX_GROUP_LABELS[g.category]} {yen(g.taxable)}
                </dt>
                <dd className="tabular-nums">{g.rate > 0 ? `消費税 ${yen(g.tax)}` : "—"}</dd>
              </div>
            ))}
            <div className="flex justify-between">
              <dt className="text-slate-600">消費税</dt>
              <dd className="tabular-nums">{yen(totals.tax)}</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-slate-200 pt-3">
              <dt className="font-semibold text-slate-800">税込合計</dt>
              <dd className="text-2xl font-bold tabular-nums text-blue-700">{yen(totals.total)}</dd>
            </div>
          </dl>
        </Card>
      </div>

      {/* ───── 保存バー ───── */}
      <div className="fixed inset-x-0 bottom-[calc(3.6rem+env(safe-area-inset-bottom))] z-30 border-t border-slate-200 bg-white/95 backdrop-blur md:bottom-0 print:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2.5 sm:px-6">
          <div className="mr-auto shrink-0 whitespace-nowrap">
            <p className="text-xs text-slate-500">税込合計</p>
            <p className="text-lg font-bold tabular-nums text-slate-800">{yen(totals.total)}</p>
          </div>
          <span className="hidden text-xs text-slate-500 sm:inline">{dirty ? "未保存の変更があります" : estimateId ? "保存済み" : ""}</span>
          {estimateId && !dirty && (
            <Link href={`/estimates/${estimateId}`} className={buttonClass("secondary", "md", "hidden sm:inline-flex")}>
              <Eye className="size-4" aria-hidden />
              PDFを確認
            </Link>
          )}
          <Button variant="secondary" onClick={() => save("view")} loading={saving} className={dirty || !estimateId ? "" : "hidden"}>
            <Eye className="size-4" aria-hidden />
            <span className="sm:hidden">確認</span>
            <span className="hidden sm:inline">保存してプレビュー</span>
          </Button>
          <Button onClick={() => save()} loading={saving}>
            <Save className="size-4" aria-hidden />
            <span className="sm:hidden">保存</span>
            <span className="hidden sm:inline">下書き保存</span>
          </Button>
        </div>
      </div>

      <PriceItemPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={addFromPrice} />
      <CustomerPicker open={customerOpen} onClose={() => setCustomerOpen(false)} onPick={pickCustomer} />
    </div>
  );
}
