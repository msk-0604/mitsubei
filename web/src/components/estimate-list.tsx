"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { EstimateSummary } from "../../../shared/types";
import { formatDateTime, formatYmd, yen } from "@/lib/format";
import { StatusBadge } from "./estimate-status";

/** 見積書の一覧（PC：表 / スマートフォン：カード） */
export function EstimateTable({ items, showUpdated = true }: { items: EstimateSummary[]; showUpdated?: boolean }) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
            <tr>
              <th className="px-4 py-2.5">見積書番号</th>
              <th className="px-4 py-2.5">宛先</th>
              <th className="px-4 py-2.5">件名</th>
              <th className="px-4 py-2.5">発行日</th>
              <th className="px-4 py-2.5 text-right">税込合計</th>
              <th className="px-4 py-2.5">ステータス</th>
              {showUpdated && <th className="px-4 py-2.5">最終更新</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((e) => (
              <tr key={e.id} className="group relative hover:bg-blue-50/40">
                <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">
                  <Link href={`/estimates/${e.id}`} className="after:absolute after:inset-0 hover:text-blue-700">
                    {e.estimateNumber}
                  </Link>
                </td>
                <td className="max-w-48 truncate px-4 py-3">
                  {e.recipientName ? `${e.recipientName} ${e.recipientHonorific}` : <span className="text-slate-400">（未入力）</span>}
                </td>
                <td className="max-w-64 truncate px-4 py-3 text-slate-600">{e.subject || <span className="text-slate-400">（未入力）</span>}</td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{formatYmd(e.issueDate)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">{yen(e.total)}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={e.status} />
                </td>
                {showUpdated && <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-slate-500">{formatDateTime(e.updatedAt)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-slate-100 md:hidden">
        {items.map((e) => (
          <li key={e.id}>
            <Link href={`/estimates/${e.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-slate-50">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="font-medium text-slate-700">{e.estimateNumber}</span>
                  <StatusBadge status={e.status} />
                  <span className="ml-auto tabular-nums">{formatYmd(e.issueDate)}</span>
                </div>
                <p className="mt-1 truncate font-medium text-slate-800">
                  {e.recipientName ? `${e.recipientName} ${e.recipientHonorific}` : "（宛先未入力）"}
                </p>
                <div className="mt-0.5 flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm text-slate-500">{e.subject || "（件名未入力）"}</p>
                  <p className="shrink-0 font-semibold tabular-nums">{yen(e.total)}</p>
                </div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-slate-300" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
