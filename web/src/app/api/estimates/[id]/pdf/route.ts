/**
 * 見積書 PDF（A4 縦）。Workers から自社の見積書データを取得し、サーバーで PDF を生成する。
 * 企業の確認は Workers 側でセッションから行う（他社の見積書は 404）。
 */
import { NextResponse, type NextRequest } from "next/server";
import type { Estimate, IssuerSnapshot } from "../../../../../../../shared/types";
import { renderEstimatePdf } from "@/lib/server/pdf";
import { callWorker, logApi } from "@/lib/server/worker";

export const maxDuration = 30;

function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 80);
}

export async function GET(request: NextRequest, ctx: RouteContext<"/api/estimates/[id]/pdf">) {
  const started = performance.now();
  const { id } = await ctx.params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return NextResponse.json({ error: { code: "not_found", message: "見つかりません" } }, { status: 404 });

  let upstream: Response;
  try {
    upstream = await callWorker(`/api/estimates/${id}/pdf-data`, { headers: request.headers });
  } catch {
    return NextResponse.json({ error: { code: "upstream_unavailable", message: "サーバーに接続できませんでした" } }, { status: 502 });
  }
  if (!upstream.ok) {
    logApi("GET", `/api/estimates/${id}/pdf`, upstream.status, Math.round(performance.now() - started));
    return new NextResponse(upstream.body, { status: upstream.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  const data = (await upstream.json()) as { estimate: Estimate; issuer: IssuerSnapshot; logo: string | null; seal?: string | null };
  const fetched = performance.now();
  const pdf = await renderEstimatePdf({ ...data, seal: data.seal ?? null });
  const ms = Math.round(performance.now() - started);
  logApi("GET", `/api/estimates/${id}/pdf`, 200, ms);

  const name = `MITUBEI_見積書_${safeFileName(data.estimate.estimateNumber)}.pdf`;
  const disposition = request.nextUrl.searchParams.get("download") ? "attachment" : "inline";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${disposition}; filename="estimate.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`,
      // 見積書の内容を含むため、ブラウザ・共有キャッシュに残さない
      "cache-control": "private, no-store",
      "server-timing": `data;dur=${Math.round(fetched - started)}, render;dur=${Math.round(performance.now() - fetched)}`,
    },
  });
}
