"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Estimate } from "../../../../../../../shared/types";
import type { EditorInitial } from "@/components/estimate-editor";
import { EstimateEditor } from "@/components/estimate-editor";
import { Alert, PageTitle, Spinner, buttonClass } from "@/components/ui";
import { useApi } from "@/lib/api";

export default function EditEstimatePage() {
  const { id } = useParams<{ id: string }>();
  // 編集画面は常に最新の内容から始める（古いキャッシュで上書きしないため）
  const { data: estimate, error } = useApi<Estimate>(`/estimates/${id}`, { revalidateOnMount: true, dedupingInterval: 0, keepPreviousData: false });
  const { data: defaults } = useApi<EditorInitial["defaults"]>("/estimates/defaults");
  const ready = estimate && defaults && estimate.id === id;
  return (
    <div>
      <PageTitle
        title={estimate ? `見積書の編集　${estimate.estimateNumber}` : "見積書の編集"}
        back={
          <Link href={`/estimates/${id}`} className="-ml-2 rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="詳細へ戻る">
            <ChevronLeft className="size-5" />
          </Link>
        }
      />
      {error ? (
        <Alert>{error.message}</Alert>
      ) : !ready ? (
        <Spinner />
      ) : estimate.status !== "draft" ? (
        <div className="space-y-3">
          <Alert tone="warning">発行済みの見積書は編集できません。内容を変更する場合は、詳細画面の「改訂版を作成」を使ってください。</Alert>
          <Link href={`/estimates/${id}`} className={buttonClass("secondary")}>
            詳細へ戻る
          </Link>
        </div>
      ) : (
        <EstimateEditor key={estimate.id} init={{ estimate, defaults }} />
      )}
    </div>
  );
}
