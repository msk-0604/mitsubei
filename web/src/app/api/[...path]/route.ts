/**
 * BFF：ブラウザ → Next.js サーバー → Cloudflare Workers API
 * 許可したパスだけを転送し、内部用の秘密値を付ける。セッション Cookie はそのまま受け渡す（httpOnly）。
 */
import { NextResponse, type NextRequest } from "next/server";
import { callWorker, isSameOrigin, logApi } from "@/lib/server/worker";

const ID = "[0-9a-fA-F-]{36}";
const ALLOWED: Array<{ methods: string[]; pattern: RegExp }> = [
  // 認証（Better Auth）
  { methods: ["POST"], pattern: /^auth\/(sign-in\/email|sign-out|change-password)$/ },
  { methods: ["GET"], pattern: /^auth\/get-session$/ },
  { methods: ["GET"], pattern: /^(me|dashboard|audit-logs)$/ },
  { methods: ["GET", "POST"], pattern: /^(customers|price-categories|price-items|estimates|members)$/ },
  { methods: ["GET", "PATCH", "DELETE"], pattern: new RegExp(`^(customers|price-items)/${ID}$`) },
  { methods: ["PATCH", "DELETE"], pattern: new RegExp(`^price-categories/${ID}$`) },
  { methods: ["GET"], pattern: /^price-items\/export$/ },
  { methods: ["POST"], pattern: /^price-items\/import$/ },
  { methods: ["GET"], pattern: /^estimates\/defaults$/ },
  { methods: ["GET", "PUT", "DELETE"], pattern: new RegExp(`^estimates/${ID}$`) },
  { methods: ["POST"], pattern: new RegExp(`^estimates/${ID}/(issue|status|duplicate|revise)$`) },
  { methods: ["GET", "PUT"], pattern: /^settings$/ },
  { methods: ["POST", "DELETE"], pattern: /^settings\/logo$/ },
  { methods: ["GET"], pattern: new RegExp(`^logos/${ID}$`) },
  { methods: ["PATCH"], pattern: new RegExp(`^members/${ID}$`) },
  { methods: ["POST"], pattern: new RegExp(`^members/${ID}/password$`) },
];

const MAX_BODY = 1024 * 1024;

function error(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });
}

async function forward(request: NextRequest, ctx: RouteContext<"/api/[...path]">) {
  const started = performance.now();
  const { path } = await ctx.params;
  const joined = path.join("/");
  const rule = ALLOWED.find((r) => r.pattern.test(joined));
  if (!rule) return error(404, "not_found", "見つかりません");
  if (!rule.methods.includes(request.method)) return error(405, "method_not_allowed", "許可されていない操作です");
  if (request.method !== "GET" && !isSameOrigin(request)) return error(403, "forbidden_origin", "不正なリクエストです");

  let body: ArrayBuffer | null = null;
  if (request.method !== "GET") {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY) return error(413, "payload_too_large", "送信データが大きすぎます");
  }

  let upstream: Response;
  try {
    upstream = await callWorker(`/api/${joined}`, {
      method: request.method,
      headers: request.headers,
      body,
      search: request.nextUrl.search,
    });
  } catch {
    logApi(request.method, `/api/${joined}`, 502, Math.round(performance.now() - started));
    return error(502, "upstream_unavailable", "サーバーに接続できませんでした。時間をおいて再度お試しください");
  }
  const ms = Math.round(performance.now() - started);
  logApi(request.method, `/api/${joined}`, upstream.status, ms);

  const headers = new Headers({
    "content-type": upstream.headers.get("content-type") ?? "application/json",
    "cache-control": upstream.headers.get("cache-control") ?? "no-store",
    "server-timing": [upstream.headers.get("server-timing"), `bff;dur=${ms}`].filter(Boolean).join(", "),
    "x-content-type-options": "nosniff",
  });
  const disposition = upstream.headers.get("content-disposition");
  if (disposition) headers.set("content-disposition", disposition);
  // ログイン・ログアウト時のセッション Cookie
  for (const c of upstream.headers.getSetCookie()) headers.append("set-cookie", c);

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
