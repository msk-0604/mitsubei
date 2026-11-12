"use client";

import { Download, FolderCog, Pencil, Plus, Search, Tags, Trash2, Upload } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { PRICE_SCALE, TAX_CATEGORIES, TAX_CATEGORY_LABELS, parseDecimal, type TaxCategory } from "../../../../../shared/calc";
import type { Paged, PriceCategory, PriceItem } from "../../../../../shared/types";
import { useMe } from "@/components/app-shell";
import { CsvImportModal } from "@/components/csv-import";
import { Alert, Badge, Button, Card, EmptyState, Field, Modal, PageTitle, Pagination, Select, Spinner, TextArea, TextInput, useConfirm, useToast } from "@/components/ui";
import { ApiError, api, errorMessage, useApi } from "@/lib/api";
import { formatYmd, formatNumberString } from "@/lib/format";

type ItemForm = {
  code: string;
  name: string;
  categoryId: string;
  spec: string;
  unit: string;
  unitPrice: string;
  taxCategory: TaxCategory;
  notes: string;
  isActive: boolean;
};

const emptyForm: ItemForm = { code: "", name: "", categoryId: "", spec: "", unit: "", unitPrice: "", taxCategory: "standard", notes: "", isActive: true };

function ItemModal({
  open,
  item,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  item: PriceItem | null;
  categories: PriceCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState<ItemForm>(() =>
      item
        ? {
            code: item.code ?? "",
            name: item.name,
            categoryId: item.categoryId ?? "",
            spec: item.spec ?? "",
            unit: item.unit ?? "",
            unitPrice: item.unitPrice,
            taxCategory: item.taxCategory,
            notes: item.notes ?? "",
            isActive: item.isActive,
          }
        : emptyForm,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ItemForm>(k: K, v: ItemForm[K]) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const local: Record<string, string> = {};
    if (!f.name.trim()) local.name = "商品名・工事項目名を入力してください";
    if (parseDecimal(f.unitPrice || "", PRICE_SCALE) === null) local.unitPrice = "単価は数値で入力してください（小数2桁まで）";
    if (Object.keys(local).length) return setErrors(local);
    setBusy(true);
    try {
      await api(item ? `/price-items/${item.id}` : "/price-items", {
        method: item ? "PATCH" : "POST",
        body: { ...f, categoryId: f.categoryId || null },
        label: "価格表の保存",
      });
      toast("success", item ? "更新しました" : "登録しました");
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={busy}
      title={item ? "価格表の編集" : "価格表に登録"}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            キャンセル
          </Button>
          <Button onClick={() => submit()} loading={busy}>
            保存
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="商品名・工事項目名" htmlFor="pi-name" required error={errors.name} className="sm:col-span-2">
          <TextInput id="pi-name" value={f.name} onChange={(e) => set("name", e.target.value)} error={errors.name} />
        </Field>
        <Field label="商品コード" htmlFor="pi-code" error={errors.code} hint="企業内で重複不可。CSV 取込時の照合に使います">
          <TextInput id="pi-code" value={f.code} onChange={(e) => set("code", e.target.value)} error={errors.code} />
        </Field>
        <Field label="カテゴリ" htmlFor="pi-cat" error={errors.categoryId}>
          <Select id="pi-cat" value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
            <option value="">（なし）</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="規格・仕様" htmlFor="pi-spec" error={errors.spec} className="sm:col-span-2">
          <TextInput id="pi-spec" value={f.spec} onChange={(e) => set("spec", e.target.value)} />
        </Field>
        <Field label="標準単価（税抜・円）" htmlFor="pi-price" required error={errors.unitPrice}>
          <TextInput id="pi-price" inputMode="decimal" value={f.unitPrice} onChange={(e) => set("unitPrice", e.target.value)} className="text-right tabular-nums" error={errors.unitPrice} />
        </Field>
        <Field label="単位" htmlFor="pi-unit" error={errors.unit}>
          <TextInput id="pi-unit" value={f.unit} onChange={(e) => set("unit", e.target.value)} placeholder="m / 個 / 式 / 人工" />
        </Field>
        <Field label="税区分" htmlFor="pi-tax">
          <Select id="pi-tax" value={f.taxCategory} onChange={(e) => set("taxCategory", e.target.value as TaxCategory)}>
            {TAX_CATEGORIES.map((t) => (
              <option key={t} value={t}>
                {TAX_CATEGORY_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="状態" htmlFor="pi-active" hint="無効にすると見積書の「価格表から追加」に表示されません">
          <Select id="pi-active" value={f.isActive ? "1" : "0"} onChange={(e) => set("isActive", e.target.value === "1")}>
            <option value="1">有効</option>
            <option value="0">無効</option>
          </Select>
        </Field>
        <Field label="備考" htmlFor="pi-notes" className="sm:col-span-2">
          <TextArea id="pi-notes" value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className="min-h-16" />
        </Field>
        {item && (
          <p className="text-xs text-slate-500 sm:col-span-2">
            単価を変更しても、作成済みの見積書の金額は変わりません（見積書には追加した時点の単価が保存されています）。
          </p>
        )}
      </form>
    </Modal>
  );
}

function CategoriesModal({ open, onClose, categories, onChanged }: { open: boolean; onClose: () => void; categories: PriceCategory[]; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api("/price-categories", { method: "POST", body: { name, sortOrder: categories.length } });
      setName("");
      onChanged();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function rename() {
    if (!editing) return;
    const c = categories.find((x) => x.id === editing.id);
    try {
      await api(`/price-categories/${editing.id}`, { method: "PATCH", body: { name: editing.name, sortOrder: c?.sortOrder ?? 0 } });
      setEditing(null);
      onChanged();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  }
  async function remove(c: PriceCategory) {
    const ok = await confirm({
      title: "カテゴリを削除しますか？",
      message: `「${c.name}」を削除します。属している商品（${c.itemCount ?? 0}件）は「カテゴリなし」になります。`,
      confirmLabel: "削除する",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/price-categories/${c.id}`, { method: "DELETE" });
      onChanged();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="カテゴリの管理">
      <form onSubmit={add} className="mb-4 flex gap-2">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="新しいカテゴリ名" aria-label="新しいカテゴリ名" />
        <Button type="submit" loading={busy}>
          追加
        </Button>
      </form>
      {categories.length === 0 ? (
        <p className="text-sm text-slate-500">カテゴリはまだありません。</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-3 py-2">
              {editing?.id === c.id ? (
                <>
                  <TextInput value={editing.name} onChange={(e) => setEditing({ id: c.id, name: e.target.value })} className="h-9" aria-label="カテゴリ名" />
                  <Button size="sm" onClick={rename}>
                    保存
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1">{c.name}</span>
                  <span className="text-xs text-slate-500">{c.itemCount ?? 0}件</span>
                  <Button variant="ghost" size="sm" className="px-2" onClick={() => setEditing({ id: c.id, name: c.name })} aria-label={`${c.name}の名前を変更`}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="px-2 text-red-600" onClick={() => remove(c)} aria-label={`${c.name}を削除`}>
                    <Trash2 className="size-4" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

const SORTS = [
  ["name", "名前順"],
  ["code", "商品コード順"],
  ["price_asc", "単価の安い順"],
  ["price_desc", "単価の高い順"],
  ["updated", "更新が新しい順"],
] as const;

export default function PricesPage() {
  const me = useMe();
  const toast = useToast();
  const confirm = useConfirm();
  const canEdit = me.permissions.editPrices;
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [sort, setSort] = useState("name");
  const [active, setActive] = useState("active");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<PriceItem | null>(null);
  const [itemOpen, setItemOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  // 条件が変わったら1ページ目に戻す（描画中に調整：https://react.dev/learn/you-might-not-need-an-effect）
  const filterKey = `${q}|${categoryId}|${sort}|${active}`;
  const [prevFilter, setPrevFilter] = useState(filterKey);
  if (filterKey !== prevFilter) {
    setPrevFilter(filterKey);
    setPage(1);
  }

  const cats = useApi<{ items: PriceCategory[] }>("/price-categories");
  const query = new URLSearchParams({ q, categoryId, sort, active, page: String(page), pageSize: "50" });
  const { data, error, isLoading, isValidating, mutate } = useApi<Paged<PriceItem>>(`/price-items?${query}`);
  const categories = cats.data?.items ?? [];

  const refresh = () => {
    void mutate();
    void cats.mutate();
  };

  async function remove(it: PriceItem) {
    const ok = await confirm({
      title: "価格表から削除しますか？",
      message: (
        <>
          「{it.name}」を削除します。作成済みの見積書には影響しません。
          <br />
          一時的に使わない場合は、編集画面で「無効」にすることもできます。
        </>
      ),
      confirmLabel: "削除する",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/price-items/${it.id}`, { method: "DELETE" });
      toast("success", "削除しました");
      refresh();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  }

  return (
    <div>
      <PageTitle
        title="価格表"
        actions={
          <>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- CSV のダウンロード（API） */}
            <a href="/api/price-items/export" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Download className="size-4" aria-hidden />
              CSV出力
            </a>
            {canEdit && (
              <>
                <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
                  <Upload className="size-4" aria-hidden />
                  CSV一括登録
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setCatOpen(true)}>
                  <FolderCog className="size-4" aria-hidden />
                  カテゴリ
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setEditing(null);
                    setItemOpen(true);
                  }}
                >
                  <Plus className="size-4" aria-hidden />
                  新規登録
                </Button>
              </>
            )}
          </>
        }
      />
      {!canEdit && <div className="mb-3"><Alert tone="info">価格表の閲覧のみできます。登録・編集は管理者に依頼してください。</Alert></div>}

      <Card className="mb-4 p-3 sm:p-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_12rem_10rem_9rem]">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <TextInput value={text} onChange={(e) => setText(e.target.value)} placeholder="商品名・商品コード・規格で検索" className="pl-9" aria-label="価格表を検索" />
          </div>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="カテゴリ">
            <option value="">すべてのカテゴリ</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="none">（カテゴリなし）</option>
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="並び順">
            {SORTS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <Select value={active} onChange={(e) => setActive(e.target.value)} aria-label="状態">
            <option value="active">有効のみ</option>
            <option value="inactive">無効のみ</option>
            <option value="all">すべて</option>
          </Select>
        </div>
      </Card>

      {error && <Alert>{error.message}</Alert>}
      <Card className={isValidating && data ? "opacity-70 transition-opacity" : ""}>
        {isLoading && !data ? (
          <Spinner />
        ) : data && data.items.length > 0 ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">コード</th>
                    <th className="px-4 py-2.5">商品名・工事項目 / 規格</th>
                    <th className="px-4 py-2.5">カテゴリ</th>
                    <th className="px-4 py-2.5">単位</th>
                    <th className="px-4 py-2.5 text-right">標準単価</th>
                    <th className="px-4 py-2.5">税区分</th>
                    <th className="px-4 py-2.5">更新日</th>
                    {canEdit && <th className="w-24 px-4 py-2.5" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((it) => (
                    <tr key={it.id} className={it.isActive ? "" : "bg-slate-50 text-slate-400"}>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">{it.code}</td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium">
                          {it.name} {!it.isActive && <Badge>無効</Badge>}
                        </p>
                        {it.spec && <p className="text-xs text-slate-500">{it.spec}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{it.categoryName}</td>
                      <td className="px-4 py-2.5">{it.unit}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums">{formatNumberString(it.unitPrice)}円</td>
                      <td className="px-4 py-2.5 text-xs">{TAX_CATEGORY_LABELS[it.taxCategory]}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums text-slate-500">{formatYmd(it.updatedAt.slice(0, 10))}</td>
                      {canEdit && (
                        <td className="whitespace-nowrap px-4 py-1.5 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="px-2"
                            onClick={() => {
                              setEditing(it);
                              setItemOpen(true);
                            }}
                            aria-label={`${it.name}を編集`}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button variant="ghost" size="sm" className="px-2 text-red-600" onClick={() => remove(it)} aria-label={`${it.name}を削除`}>
                            <Trash2 className="size-4" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-slate-100 md:hidden">
              {data.items.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => {
                      setEditing(it);
                      setItemOpen(true);
                    }}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left ${it.isActive ? "" : "opacity-60"}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{it.name}</p>
                      <p className="truncate text-xs text-slate-500">{[it.code, it.categoryName, it.spec].filter(Boolean).join(" ・ ")}</p>
                    </div>
                    <p className="shrink-0 text-right font-semibold tabular-nums">
                      {formatNumberString(it.unitPrice)}円<span className="block text-xs font-normal text-slate-500">/ {it.unit ?? "—"}</span>
                    </p>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
          </>
        ) : (
          <EmptyState icon={<Tags className="size-10" />} title={q || categoryId ? "条件に合う商品はありません" : "価格表はまだ空です"}>
            {canEdit && "「新規登録」または「CSV一括登録」から登録できます。"}
          </EmptyState>
        )}
      </Card>

      {itemOpen && <ItemModal open item={editing} categories={categories} onClose={() => setItemOpen(false)} onSaved={refresh} />}
      <CategoriesModal open={catOpen} onClose={() => setCatOpen(false)} categories={categories} onChanged={refresh} />
      <CsvImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={refresh} />
    </div>
  );
}
