import "server-only";

/**
 * Cloudflare Workers API の呼び出し（サーバー専用）。
 * Workers の URL と内部用の秘密値はここでのみ使い、ブラウザには一切渡さない。
 */

export const SESSION_COOKIE_NAMES = ["mitubei.session_token", "__Secure-mitubei.session_token"];

function config() {
  const url = process.env.WORKER_API_URL;
  const secret = process.env.INTERNAL_API_SECRET;
  if (!url || !secret) throw new Error("WORKER_API_URL / INTERNAL_API_SECRET が設定されていません");
  return { url: url.replace(/\/$/, ""), secret };
}

/** リクエスト元のクライアント IP（Vercel が付けるヘッダー） */
export function clientIpFrom(headers: Headers): string {
  return headers.get("x-real-ip") || headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** 状態を変更するリクエストが同一オリジンから来たか（CSRF 対策） */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * ブラウザからのリクエストを Workers に転送する。
 * 転送するヘッダーは必要なものだけ（Cookie・Origin・Content-Type・クライアント IP）。
 */
export async function callWorker(
  path: string,
  init: { method?: string; headers: Headers; body?: ArrayBuffer | string | null; search?: string },
): Promise<Response> {
  const { url, secret } = config();
  const h = new Headers({ "x-mitubei-internal-secret": secret, "x-mitubei-client-ip": clientIpFrom(init.headers) });
  for (const name of ["cookie", "origin", "content-type", "user-agent"]) {
    const v = init.headers.get(name);
    if (v) h.set(name, v);
  }
  return fetch(`${url}${path}${init.search ?? ""}`, {
    method: init.method ?? "GET",
    headers: h,
    body: init.body ?? undefined,
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
}

/** 個人情報を含めないよう ID・クエリを除いたパスでログを出す */
export function logApi(method: string, path: string, status: number, ms: number) {
  const safePath = path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id");
  console.info(JSON.stringify({ type: "bff", method, path: safePath, status, ms }));
}
