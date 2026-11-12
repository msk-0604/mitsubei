"use client";

import { FileText, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ESTIMATE_STATUSES, STATUS_LABELS, type EstimateSummary, type Paged } from "../../../../../shared/types";
import { useApi } from "@/lib/api";
import { EstimateTable } from "@/components/estimate-list";
import { Alert, Button, Card, EmptyState, PageTitle, Pagination, Select, Spinner, TextInput, buttonClass } from "@/components/ui";

const SORTS = [
  ["issue_desc", "発行日が新しい順"],
  ["issue_asc", "発行日が古い順"],
  ["updated_desc", "最終更新が新しい順"],
  ["total_desc", "金額が大きい順"],
  ["number_desc", "番号の降順"],
] as const;

function EstimatesList() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const sort = params.get("sort") ?? "issue_desc";
  const page = Number(params.get("page") ?? "1") || 1;

  const [text, setText] = useState(q);
  const [prevQ, setPrevQ] = useState(q);
  if (q !== prevQ) {
    setPrevQ(q);
    setText(q);
  }

  function update(next: Record<string, string>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    if (!("page" in next)) sp.delete("page");
    router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`, { scroll: false });
  }

  // 入力が止まってから検索（毎キーでの通信を避ける）
  useEffect(() => {
    if (text === q) return;
    const t = setTimeout(() => update({ q: text.trim() }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const query = new URLSearchParams({ q, status, from, to, sort, page: String(page), pageSize: "30" });
  const { data, error, isLoading, isValidating } = useApi<Paged<EstimateSummary>>(`/estimates?${query}`);
  const filtered = !!(q || status || from || to);

  return (
    <div>
      <PageTitle
        title="見積書"
        actions={
          <Link href="/estimates/new" className={buttonClass("primary")}>
            <Plus className="size-4" aria-hidden />
            新しい見積書を作成
          </Link>
        }
      />
      <Card className="mb-4 p-3 sm:p-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto]">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <TextInput value={text} onChange={(e) => setText(e.target.value)} placeholder="番号・宛先・件名・工事名" className="pl-9" aria-label="キーワード" />
          </div>
          <Select value={status} onChange={(e) => update({ status: e.target.value })} aria-label="ステータス" className="lg:w-36">
            <option value="">すべての状態</option>
            {ESTIMATE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select value={sort} onChange={(e) => update({ sort: e.target.value })} aria-label="並び順" className="lg:w-48">
            {SORTS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <div className="flex items-center gap-1.5 sm:col-span-2 lg:col-span-2">
            <TextInput type="date" value={from} onChange={(e) => update({ from: e.target.value })} aria-label="発行日（から）" className="lg:w-40" />
            <span className="text-slate-400">〜</span>
            <TextInput type="date" value={to} onChange={(e) => update({ to: e.target.value })} aria-label="発行日（まで）" className="lg:w-40" />
          </div>
        </div>
        {filtered && (
          <div className="mt-2 flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => router.replace(pathname)}>
              <X className="size-4" aria-hidden />
              条件をクリア
            </Button>
          </div>
        )}
      </Card>

      {error && <Alert>{error.message}</Alert>}
      <Card className={isValidating && data ? "opacity-70 transition-opacity" : ""}>
        {isLoading && !data ? (
          <Spinner />
        ) : data && data.items.length > 0 ? (
          <>
            <EstimateTable items={data.items} />
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(p) => update({ page: String(p) })} />
          </>
        ) : (
          <EmptyState icon={<FileText className="size-10" />} title={filtered ? "条件に合う見積書はありません" : "まだ見積書がありません"} />
        )}
      </Card>
    </div>
  );
}

export default function EstimatesPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <EstimatesList />
    </Suspense>
  );
}
