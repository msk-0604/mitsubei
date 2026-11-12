/**
 * MITUBEI API（Cloudflare Workers + D1）
 *
 * 呼び出し元は Next.js サーバー（BFF）だけを想定する。
 *  - x-mitubei-internal-secret：Next.js サーバーとだけ共有する秘密値（必須）
 *  - Cookie：Better Auth のセッション Cookie（ブラウザの Cookie を BFF がそのまま転送）
 * 企業ID・権限は常にセッションから確定し、リクエスト本文・クエリの値は使わない。
 */
import { Hono } from "hono";
import { appOrigins, getAuth } from "./auth";
import { dbMiddleware, requireAuth, type AppEnv } from "./lib/context";
import { timingSafeEqualString } from "./lib/crypto";
import { HttpError } from "./lib/http";
import { customers } from "./routes/customers";
import { dashboard, estimates } from "./routes/estimates";
import { priceCategories, priceItems } from "./routes/prices";
import { auditLogs, logos, me, members, settings } from "./routes/settings";

const INTERNAL_SECRET_HEADER = "x-mitubei-internal-secret";

const app = new Hono<AppEnv>();

/** ログには ID・クエリを除いたパスだけを出す（個人情報・金額を出さない） */
function safePath(path: string): string {
  return path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id");
}

app.use("*", async (c, next) => {
  const started = Date.now();
  await next();
  const dur = Date.now() - started;
  c.res.headers.set("server-timing", `worker;dur=${dur}`);
  c.res.headers.set("x-content-type-options", "nosniff");
  if (!c.res.headers.has("cache-control")) c.res.headers.set("cache-control", "no-store");
  console.info(JSON.stringify({ type: "api", method: c.req.method, path: safePath(c.req.path), status: c.res.status, ms: dur }));
});

app.get("/health", (c) => c.json({ ok: true }));

// 1) 内部用の秘密値（Next.js サーバー以外からの呼び出しを拒否）
app.use("/api/*", async (c, next) => {
  const secret = c.env.INTERNAL_API_SECRET;
  if (!secret || secret.length < 16 || !c.env.BETTER_AUTH_SECRET) {
    console.error("INTERNAL_API_SECRET / BETTER_AUTH_SECRET is not configured");
    throw new HttpError(500, "server_misconfigured", "サーバーの設定に問題があります");
  }
  if (!timingSafeEqualString(c.req.header(INTERNAL_SECRET_HEADER) ?? "", secret)) {
    throw new HttpError(401, "unauthorized_client", "認証されていないクライアントです");
  }
  await next();
});

// 2) 認証（Better Auth：ログイン・ログアウト・パスワード変更・セッション）
app.on(["GET", "POST"], "/api/auth/*", (c) => getAuth(c.env).handler(c.req.raw));

// 3) CSRF 対策：状態を変えるリクエストは、画面の Origin からのものだけ受け付ける
app.use("/api/*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = (c.req.header("origin") ?? "").replace(/\/$/, "");
    if (!origin || !appOrigins(c.env).includes(origin)) {
      throw new HttpError(403, "forbidden_origin", "不正なリクエストです");
    }
  }
  await next();
});

// 4) セッション → 所属企業・権限の確定
app.use("/api/*", dbMiddleware(), requireAuth);

app.route("/api/me", me);
app.route("/api/dashboard", dashboard);
app.route("/api/customers", customers);
app.route("/api/price-categories", priceCategories);
app.route("/api/price-items", priceItems);
app.route("/api/estimates", estimates);
app.route("/api/settings", settings);
app.route("/api/logos", logos);
app.route("/api/members", members);
app.route("/api/audit-logs", auditLogs);

app.notFound((c) => c.json({ error: { code: "not_found", message: "見つかりません" } }, 404));

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json(
      { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
      err.status as 400,
    );
  }
  // 個人情報を含めないよう、エラー種別とパスだけを記録する
  console.error(
    JSON.stringify({
      level: "error",
      method: c.req.method,
      path: safePath(c.req.path),
      // Drizzle のエラー文にはバインド値が含まれるため、原因のメッセージだけを短く残す
      error:
        err instanceof Error
          ? `${err.name}: ${(err.cause instanceof Error ? err.cause.message : err.message).replace(/params:[\s\S]*$/, "").slice(0, 200)}`
          : "unknown",
    }),
  );
  return c.json({ error: { code: "internal_error", message: "サーバーでエラーが発生しました。時間をおいて再度お試しください" } }, 500);
});

export default app;
