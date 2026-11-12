"use client";

import { ChevronLeft, Copy, Download, ExternalLink, FilePenLine, GitBranch, Pencil, Printer, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { TAX_CATEGORY_LABELS, TAX_GROUP_LABELS } from "../../../../../../shared/calc";
import { STATUS_LABELS, type Estimate, type EstimateStatus } from "../../../../../../shared/types";
import { useMe } from "@/components/app-shell";
import { StatusBadge } from "@/components/estimate-status";
import { Alert, Button, Card, CardHeader, PageTitle, Select, Spinner, buttonClass, useConfirm, useToast } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { formatDateTime, formatNumberString, formatYmd, yen } from "@/lib/format";

export default function EstimateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const me = useMe();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: e, error, mutate } = useApi<Estimate>(`/estimates/${id}`, { revalidateOnMount: true });
  const [busy, setBusy] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  if (error) return <Alert>{error.message}</Alert>;
  if (!e || e.id !== id) return <Spinner />;

  const pdfUrl = `/api/estimates/${e.id}/pdf?v=${e.version}`;
  const canDelete = me.role === "admin" || e.status === "draft";

  async function run<T>(key: string, fn: () => Promise<T>, ok: string): Promise<T | null> {
    setBusy(key);
    try {
      const r = await fn();
      toast("success", ok);
      return r;
    } catch (err) {
      toast("error", errorMessage(err));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function issue() {
    if (!e) return;
    const ok = await confirm({
      title: "見積書を発行しますか？",
      message: (
        <>
          発行すると内容が確定し、編集できなくなります（自社情報も発行時点の内容で保存されます）。
          <br />
          変更が必要になった場合は「改訂版を作成」で新しい版を作ります。
        </>
      ),
      confirmLabel: "発行する",
    });
    if (!ok) return;
    const r = await run("issue", () => api<Estimate>(`/estimates/${e.id}/issue`, { method: "POST", body: { version: e.version } }), "発行しました");
    if (r) await mutate(r, { revalidate: false });
  }

  async function changeStatus(status: EstimateStatus) {
    if (!e || status === e.status) return;
    const r = await run("status", () => api<Estimate>(`/estimates/${e.id}/status`, { method: "POST", body: { status } }), `ステータスを「${STATUS_LABELS[status]}」にしました`);
    if (r) await mutate(r, { revalidate: false });
  }

  async function duplicate() {
    if (!e) return;
    const r = await run("duplicate", () => api<Estimate>(`/estimates/${e.id}/duplicate`, { method: "POST", body: {} }), "複製しました");
    if (r) router.push(`/estimates/${r.id}/edit`);
  }

  async function revise() {
    if (!e) return;
    const ok = await confirm({
      title: "改訂版を作成しますか？",
      message: "この見積書の内容をもとに、新しい版（下書き）を作成します。元の見積書はそのまま残ります。",
      confirmLabel: "改訂版を作成",
    });
    if (!ok) return;
    const r = await run("revise", () => api<Estimate>(`/estimates/${e.id}/revise`, { method: "POST", body: {} }), "改訂版を作成しました");
    if (r) router.push(`/estimates/${r.id}/edit`);
  }

  async function remove() {
    if (!e) return;
    const ok = await confirm({
      title: "見積書を削除しますか？",
      message: (
        <>
          「{e.estimateNumber}」を削除します。一覧に表示されなくなり、元に戻せません。
          {e.status !== "draft" && <span className="mt-2 block font-medium text-red-700">この見積書は{STATUS_LABELS[e.status]}です。</span>}
        </>
      ),
      confirmLabel: "削除する",
      danger: true,
    });
    if (!ok) return;
    const r = await run("delete", () => api(`/estimates/${e.id}`, { method: "DELETE" }), "削除しました");
    if (r) router.replace("/estimates");
  }

  function print() {
    const w = frameRef.current?.contentWindow;
    if (w && window.matchMedia("(min-width: 768px)").matches) {
      try {
        w.focus();
        w.print();
        return;
      } catch {
        // PDF ビューアが印刷に対応していない場合は新しいタブで開く
      }
    }
    window.open(pdfUrl, "_blank", "noopener");
  }

  return (
    <div className="space-y-4">
      <PageTitle
        back={
          <Link href="/estimates" className="-ml-2 rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="見積書一覧へ戻る">
            <ChevronLeft className="size-5" />
          </Link>
        }
        title={
          <span className="flex items-center gap-2">
            {e.estimateNumber}
            <StatusBadge status={e.status} />
          </span>
        }
        actions={
          e.status === "draft" ? (
            <>
              <Link href={`/estimates/${e.id}/edit`} className={buttonClass("secondary")}>
                <Pencil className="size-4" aria-hidden />
                編集
              </Link>
              <Button onClick={issue} loading={busy === "issue"}>
                <Send className="size-4" aria-hidden />
                発行する
              </Button>
            </>
          ) : (
            <>
              <Select value={e.status} onChange={(ev) => changeStatus(ev.target.value as EstimateStatus)} disabled={busy === "status"} aria-label="ステータス" className="w-32">
                {(["issued", "won", "lost"] as const).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
              <Button variant="secondary" onClick={revise} loading={busy === "revise"}>
                <GitBranch className="size-4" aria-hidden />
                改訂版を作成
              </Button>
            </>
          )
        }
      />

      {e.status !== "draft" && (
        <Alert tone="info">
          発行済みのため内容は変更できません（{e.issuedAt ? formatDateTime(e.issuedAt) : ""} 発行）。変更する場合は「改訂版を作成」を使ってください。
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ───── PDF ───── */}
        <Card className="overflow-hidden">
          <CardHeader
            title="PDF"
            actions={
              <>
                <a href={`${pdfUrl}&download=1`} className={buttonClass("primary", "sm")}>
                  <Download className="size-4" aria-hidden />
                  ダウンロード
                </a>
                <Button variant="secondary" size="sm" onClick={print}>
                  <Printer className="size-4" aria-hidden />
                  印刷
                </Button>
                <a href={pdfUrl} target="_blank" rel="noopener" className={buttonClass("ghost", "sm")}>
                  <ExternalLink className="size-4" aria-hidden />
                  別タブで開く
                </a>
              </>
            }
          />
          <div className="hidden bg-slate-100 md:block">
            <iframe ref={frameRef} key={pdfUrl} src={pdfUrl} title="見積書 PDF プレビュー" className="h-[78vh] w-full" />
          </div>
          <p className="p-4 text-sm text-slate-500 md:hidden">スマートフォンでは「別タブで開く」または「ダウンロード」でPDFを確認できます。</p>
        </Card>

        {/* ───── 概要・操作 ───── */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="概要" />
            <dl className="divide-y divide-slate-100 text-sm">
              {[
                ["宛先", e.recipientName ? `${e.recipientName} ${e.recipientHonorific}` : "（未入力）"],
                ["件名", e.subject || "（未入力）"],
                ["工事名", e.projectName],
                ["工事場所", e.projectLocation],
                ["発行日", formatYmd(e.issueDate)],
                ["有効期限", formatYmd(e.validUntil)],
                ["作成者", e.createdByName],
                ["最終更新", formatDateTime(e.updatedAt)],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="flex gap-3 px-4 py-2.5">
                    <dt className="w-20 shrink-0 text-slate-500">{k}</dt>
                    <dd className="min-w-0 break-words text-slate-800">{v}</dd>
                  </div>
                ))}
            </dl>
            <div className="space-y-1 border-t border-slate-100 px-4 py-3 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>小計（税抜）</span>
                <span className="tabular-nums">{yen(e.itemsSubtotal)}</span>
              </div>
              {e.discount > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>値引き</span>
                  <span className="tabular-nums">-{yen(e.discount)}</span>
                </div>
              )}
              {e.taxGroups.map((g) => (
                <div key={g.category} className="flex justify-between text-xs text-slate-500">
                  <span>
                    {TAX_GROUP_LABELS[g.category]} {yen(g.taxable)}
                  </span>
                  <span className="tabular-nums">{g.rate > 0 ? `消費税 ${yen(g.tax)}` : "—"}</span>
                </div>
              ))}
              <div className="flex items-baseline justify-between border-t border-slate-100 pt-2">
                <span className="font-semibold">税込合計</span>
                <span className="text-xl font-bold tabular-nums text-blue-700">{yen(e.total)}</span>
              </div>
            </div>
          </Card>

          {e.revisions.length > 0 && (
            <Card>
              <CardHeader title="改訂の履歴" />
              <ul className="divide-y divide-slate-100 text-sm">
                {e.revisions.map((r) => (
                  <li key={r.id}>
                    <Link href={`/estimates/${r.id}`} className={`flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-slate-50 ${r.id === e.id ? "bg-blue-50/60" : ""}`}>
                      <span className="font-medium">
                        {r.estimateNumber}
                        {r.id === e.id && <span className="ml-1 text-xs text-blue-700">（表示中）</span>}
                      </span>
                      <StatusBadge status={r.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="p-3">
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={duplicate} loading={busy === "duplicate"}>
                <Copy className="size-4" aria-hidden />
                複製
              </Button>
              {e.status === "draft" ? (
                <Link href={`/estimates/${e.id}/edit`} className={buttonClass("secondary")}>
                  <FilePenLine className="size-4" aria-hidden />
                  編集
                </Link>
              ) : (
                <span />
              )}
              {canDelete && (
                <Button variant="ghost" className="col-span-2 text-red-600 hover:bg-red-50" onClick={remove} loading={busy === "delete"}>
                  <Trash2 className="size-4" aria-hidden />
                  削除
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* ───── 明細（確認用） ───── */}
      <Card>
        <CardHeader title={`明細（${e.items.length}行）`} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">品名・規格</th>
                <th className="px-4 py-2 text-right">数量</th>
                <th className="px-4 py-2">単位</th>
                <th className="px-4 py-2 text-right">単価</th>
                <th className="px-4 py-2 text-right">金額</th>
                <th className="px-4 py-2">税区分</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {e.items.map((it) => (
                <tr key={it.id}>
                  <td className="px-4 py-2">
                    <p className="font-medium">{it.name}</p>
                    {(it.spec || it.notes) && <p className="text-xs text-slate-500">{[it.spec, it.notes].filter(Boolean).join(" / ")}</p>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatNumberString(it.quantity)}</td>
                  <td className="px-4 py-2">{it.unit}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatNumberString(it.unitPrice)}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">{yen(it.amount)}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{TAX_CATEGORY_LABELS[it.taxCategory]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
