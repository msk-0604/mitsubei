"use client";

import { ArrowRight, FileText, Plus, Search, Tags } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { Dashboard } from "../../../../shared/types";
import { useApi } from "@/lib/api";
import { yen } from "@/lib/format";
import { EstimateTable } from "@/components/estimate-list";
import { Alert, Card, CardHeader, EmptyState, Spinner, TextInput, buttonClass } from "@/components/ui";

function Stat({ label, value, sub, className = "" }: { label: string; value: string; sub?: string; className?: string }) {
  return (
    <Card className={`p-4 sm:p-5 ${className}`}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-800 sm:text-[26px]">{value}</p>
      {sub && <p className="mt-0.5 text-xs tabular-nums text-slate-500">{sub}</p>}
    </Card>
  );
}

export default function HomePage() {
  const router = useRouter();
  const { data, error, isLoading } = useApi<Dashboard>("/dashboard");
  const [q, setQ] = useState("");

  function search(e: FormEvent) {
    e.preventDefault();
    router.push(`/estimates${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
  }

  const monthLabel = data ? `${Number(data.month.slice(5))}月` : "今月";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">ホーム</h1>
        <Link href="/estimates/new" className={buttonClass("primary", "lg")}>
          <Plus className="size-5" aria-hidden />
          新しい見積書を作成
        </Link>
      </div>

      <form onSubmit={search} className="relative" role="search">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400" aria-hidden />
        <TextInput
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="見積書を検索（番号・宛先・件名・工事名）"
          className="h-12 pl-10"
          aria-label="見積書を検索"
          enterKeyHint="search"
        />
      </form>

      {error && <Alert>{error.message}</Alert>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label={`${monthLabel}の見積書作成件数`} value={data ? `${data.monthCount.toLocaleString()}件` : "—"} />
        <Stat
          className="order-first col-span-2 sm:order-none sm:col-span-1"
          label={`${monthLabel}の見積金額合計（税込）`}
          value={data ? yen(data.monthTotal) : "—"}
          sub={data ? `税抜 ${yen(data.monthSubtotal)}` : undefined}
        />
        <Stat label="保存済み見積書" value={data ? `${data.savedCount.toLocaleString()}件` : "—"} sub="下書きを含む" />
      </div>

      <Card>
        <CardHeader
          title="最近作成した見積書"
          actions={
            <Link href="/estimates" className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline">
              すべて見る
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          }
        />
        {isLoading && !data ? (
          <Spinner />
        ) : data && data.recent.length > 0 ? (
          <EstimateTable items={data.recent} showUpdated={false} />
        ) : (
          <EmptyState icon={<FileText className="size-10" />} title="まだ見積書がありません">
            <Link href="/estimates/new" className={buttonClass("primary", "md", "mt-3")}>
              <Plus className="size-4" aria-hidden />
              最初の見積書を作成
            </Link>
          </EmptyState>
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/prices" className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-300">
          <Tags className="size-6 text-blue-600" aria-hidden />
          <div>
            <p className="font-medium text-slate-800">価格表を管理</p>
            <p className="text-xs text-slate-500">商品・工事項目と標準単価の登録、CSV一括登録</p>
          </div>
        </Link>
        <Link href="/customers" className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-300">
          <FileText className="size-6 text-blue-600" aria-hidden />
          <div>
            <p className="font-medium text-slate-800">顧客を管理</p>
            <p className="text-xs text-slate-500">宛先の登録。見積書作成時に選ぶだけで反映されます</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
