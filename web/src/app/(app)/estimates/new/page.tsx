"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { EditorInitial } from "@/components/estimate-editor";
import { EstimateEditor } from "@/components/estimate-editor";
import { Alert, PageTitle, Spinner } from "@/components/ui";
import { useApi } from "@/lib/api";

export default function NewEstimatePage() {
  // 採番プレビューは毎回最新を取る
  const { data, error } = useApi<EditorInitial["defaults"]>("/estimates/defaults", { revalidateOnMount: true, dedupingInterval: 0 });
  return (
    <div>
      <PageTitle
        title="新しい見積書"
        back={
          <Link href="/estimates" className="-ml-2 rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="見積書一覧へ戻る">
            <ChevronLeft className="size-5" />
          </Link>
        }
      />
      {error ? <Alert>{error.message}</Alert> : data ? <EstimateEditor init={{ estimate: null, defaults: data }} /> : <Spinner />}
    </div>
  );
}
