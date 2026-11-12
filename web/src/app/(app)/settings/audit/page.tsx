"use client";

import { Alert, Card, PageTitle, Spinner } from "@/components/ui";
import { useApi } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

type Log = { id: string; action: string; entityType: string; entityId: string | null; detail: string | null; createdAt: string; userName: string | null };

const ACTIONS: Record<string, string> = {
  "estimate.create": "見積書を作成",
  "estimate.update": "見積書を保存",
  "estimate.issue": "見積書を発行",
  "estimate.status": "ステータスを変更",
  "estimate.duplicate": "見積書を複製",
  "estimate.revise": "改訂版を作成",
  "estimate.delete": "見積書を削除",
  "price_item.create": "価格表に登録",
  "price_item.update": "価格表を更新",
  "price_item.delete": "価格表から削除",
  "price_item.import": "価格表をCSV一括登録",
  "price_category.create": "カテゴリを作成",
  "price_category.update": "カテゴリを更新",
  "price_category.delete": "カテゴリを削除",
  "customer.create": "顧客を登録",
  "customer.update": "顧客を更新",
  "customer.archive": "顧客を削除",
  "settings.update": "企業設定を変更",
  "settings.logo": "ロゴを登録",
  "settings.logo_remove": "ロゴを外す",
  "member.create": "社員を追加",
  "member.update": "社員の権限・状態を変更",
  "member.password_reset": "社員のパスワードを再設定",
};

export default function AuditPage() {
  const { data, error } = useApi<{ items: Log[] }>("/audit-logs");
  return (
    <div>
      <PageTitle title="操作ログ（直近200件）" />
      {error && <Alert>{error.message}</Alert>}
      <Card>
        {!data ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {data.items.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2.5">
                <span className="w-36 shrink-0 text-xs tabular-nums text-slate-500">{formatDateTime(l.createdAt)}</span>
                <span className="w-28 shrink-0 truncate text-slate-600">{l.userName ?? "—"}</span>
                <span className="font-medium">{ACTIONS[l.action] ?? l.action}</span>
                {l.detail && <span className="truncate text-xs text-slate-500">{l.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
