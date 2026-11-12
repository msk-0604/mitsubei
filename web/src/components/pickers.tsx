"use client";

import { Check, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { TAX_CATEGORY_LABELS } from "../../../shared/calc";
import type { Customer, Paged, PriceCategory, PriceItem } from "../../../shared/types";
import { useApi } from "@/lib/api";
import { formatNumberString } from "@/lib/format";
import { Badge, Button, EmptyState, Modal, Pagination, Select, Spinner, TextInput } from "./ui";

function useDebounced(value: string, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** 価格表から明細に追加するモーダル。開いたまま続けて複数追加できる */
export function PriceItemPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (item: PriceItem) => void }) {
  const [text, setText] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [page, setPage] = useState(1);
  const [added, setAdded] = useState<Record<string, number>>({});
  const q = useDebounced(text.trim());
  const filterKey = `${q}|${categoryId}|${open}`;
  const [prevFilter, setPrevFilter] = useState(filterKey);
  if (filterKey !== prevFilter) {
    setPrevFilter(filterKey);
    setPage(1);
    if (open && !prevFilter.endsWith("|true")) setAdded({});
  }

  const { data: cats } = useApi<{ items: PriceCategory[] }>(open ? "/price-categories" : null);
  const query = new URLSearchParams({ q, categoryId, page: String(page), pageSize: "30", sort: "name", active: "active" });
  const { data, isLoading } = useApi<Paged<PriceItem>>(open ? `/price-items?${query}` : null);
  const total = Object.values(added).reduce((a, b) => a + b, 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="価格表から追加"
      size="xl"
      footer={
        <>
          {total > 0 && <span className="mr-auto self-center text-sm text-emerald-700">{total}件を明細に追加しました</span>}
          <Button onClick={onClose}>完了</Button>
        </>
      }
    >
      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_14rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <TextInput
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="商品名・商品コード・規格で検索"
            className="pl-9"
            aria-label="価格表を検索"
            data-autofocus
          />
        </div>
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="カテゴリ">
          <option value="">すべてのカテゴリ</option>
          {cats?.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      {isLoading && !data ? (
        <Spinner />
      ) : data && data.items.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <ul className="divide-y divide-slate-100">
            {data.items.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(it);
                    setAdded((a) => ({ ...a, [it.id]: (a[it.id] ?? 0) + 1 }));
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-blue-50 active:bg-blue-100"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-800">
                      {it.name}
                      {it.spec && <span className="ml-2 text-xs font-normal text-slate-500">{it.spec}</span>}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                      {it.code && <span>{it.code}</span>}
                      {it.categoryName && <span>{it.categoryName}</span>}
                      {it.taxCategory !== "standard" && <Badge tone="amber">{TAX_CATEGORY_LABELS[it.taxCategory]}</Badge>}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold tabular-nums">
                      {formatNumberString(it.unitPrice)}円<span className="text-xs font-normal text-slate-500"> / {it.unit ?? "—"}</span>
                    </p>
                  </div>
                  <span
                    className={`flex size-8 shrink-0 items-center justify-center rounded-full ${added[it.id] ? "bg-emerald-600 text-white" : "bg-blue-600 text-white"}`}
                    aria-hidden
                  >
                    {added[it.id] ? <Check className="size-4" /> : <Plus className="size-4" />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
        </div>
      ) : (
        <EmptyState title="該当する商品がありません">価格表にない項目は、明細に直接入力できます。</EmptyState>
      )}
    </Modal>
  );
}

/** 顧客を選んで宛先に反映するモーダル */
export function CustomerPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (c: Customer) => void }) {
  const [text, setText] = useState("");
  const q = useDebounced(text.trim());
  const { data, isLoading } = useApi<Paged<Customer>>(open ? `/customers?${new URLSearchParams({ q, pageSize: "50" })}` : null);
  return (
    <Modal open={open} onClose={onClose} title="顧客から選ぶ" size="lg">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <TextInput value={text} onChange={(e) => setText(e.target.value)} placeholder="顧客名・担当者・電話番号" className="pl-9" aria-label="顧客を検索" data-autofocus />
      </div>
      {isLoading && !data ? (
        <Spinner />
      ) : data && data.items.length > 0 ? (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
          {data.items.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="w-full px-3 py-2.5 text-left hover:bg-blue-50"
                onClick={() => {
                  onPick(c);
                  onClose();
                }}
              >
                <p className="font-medium text-slate-800">
                  {c.name} <span className="text-sm font-normal text-slate-500">{c.honorific}</span>
                </p>
                <p className="mt-0.5 truncate text-xs text-slate-500">{[c.contactName, c.phone, c.address].filter(Boolean).join("　")}</p>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="顧客が見つかりません">「顧客」画面から登録できます。</EmptyState>
      )}
    </Modal>
  );
}
