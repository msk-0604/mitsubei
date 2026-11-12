/**
 * 認証（Better Auth）
 *
 * - メールアドレス + パスワード。パスワードは PBKDF2-SHA256（lib/crypto.ts）でハッシュ化して保存する。
 * - 自己登録（サインアップ）は無効。企業と最初の管理者は運営者がスクリプトで作成し、社員は管理者が追加する。
 * - セッションは D1 の sessions テーブル。Cookie は署名付き・httpOnly・SameSite=Lax（本番は Secure）。
 * - 不正ログイン対策：
 *    ・IP ごとのレート制限（Better Auth、D1 に保存）
 *    ・メールアドレスごとの試行回数制限（15分で10回。login_attempts）
 *    ・無効化された社員・停止中の企業はログイン不可
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { and, eq, sql } from "drizzle-orm";
import { hashPassword, sha256Hex, verifyPassword } from "./lib/crypto";
import { getDb, schema } from "./lib/db";

export const CLIENT_IP_HEADER = "x-mitubei-client-ip";
const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS_PER_EMAIL = 10;

export function appOrigins(env: Env): string[] {
  return (env.APP_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

/** 固定ウィンドウで試行回数を数える（原子的な UPSERT） */
export async function bumpAttempt(db: D1Database, key: string): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(
      `INSERT INTO login_attempts (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN login_attempts.window_start <= ?3 THEN 1 ELSE login_attempts.count + 1 END,
         window_start = CASE WHEN login_attempts.window_start <= ?3 THEN ?2 ELSE login_attempts.window_start END
       RETURNING count`,
    )
    .bind(key, now, now - WINDOW_SECONDS)
    .first<{ count: number }>();
  return row?.count ?? 1;
}

function createAuth(env: Env) {
  const db = getDb(env.DB);
  const origins = appOrigins(env);
  const ttlDays = Number(env.SESSION_TTL_DAYS) || 14;

  return betterAuth({
    appName: "MITUBEI",
    baseURL: origins[0] ?? "http://localhost:3000",
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: origins,
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
        rate_limits: schema.rateLimits,
      },
    }),
    user: { modelName: "users" },
    session: {
      modelName: "sessions",
      expiresIn: ttlDays * 86400,
      updateAge: 86400,
    },
    account: { modelName: "accounts" },
    verification: { modelName: "verifications" },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(password, hash),
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rate_limits",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 15 * 60, max: 30 },
        "/change-password": { window: 15 * 60, max: 10 },
      },
    },
    advanced: {
      cookiePrefix: "mitubei",
      // Next.js サーバー（BFF）が実際のクライアント IP をこのヘッダーに入れて転送する
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      database: { generateId: () => crypto.randomUUID() },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return;
        const email = String((ctx.body as { email?: unknown } | undefined)?.email ?? "")
          .trim()
          .toLowerCase();
        if (!email) return;
        const count = await bumpAttempt(env.DB, `email:${await sha256Hex(email)}`);
        if (count > MAX_ATTEMPTS_PER_EMAIL) {
          throw new APIError("TOO_MANY_REQUESTS", {
            message: "ログイン試行回数が多すぎます。15分ほど待ってから再度お試しください",
          });
        }
        // 無効化された社員・停止中の企業はログインさせない（存在の有無は明かさない）
        const row = await db
          .select({ status: schema.organizationMemberships.status, orgStatus: sql<string>`${schema.organizations.status}`.as("org_status") })
          .from(schema.users)
          .innerJoin(schema.organizationMemberships, eq(schema.organizationMemberships.userId, schema.users.id))
          .innerJoin(schema.organizations, eq(schema.organizations.id, schema.organizationMemberships.organizationId))
          .where(eq(schema.users.email, email))
          .get();
        if (row && (row.status !== "active" || row.orgStatus !== "active")) {
          throw new APIError("UNAUTHORIZED", { message: "メールアドレスまたはパスワードが正しくありません" });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/email" && ctx.context.newSession) {
          const email = ctx.context.newSession.user.email.toLowerCase();
          await env.DB.prepare(`DELETE FROM login_attempts WHERE key = ?1`)
            .bind(`email:${await sha256Hex(email)}`)
            .run();
        }
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

// 同じ isolate 内では Better Auth のインスタンスを使い回す（初期化コストの削減）
let cached: { env: Env; auth: Auth } | null = null;
export function getAuth(env: Env): Auth {
  if (cached && cached.env.DB === env.DB && cached.env.BETTER_AUTH_SECRET === env.BETTER_AUTH_SECRET) return cached.auth;
  const auth = createAuth(env);
  cached = { env, auth };
  return auth;
}

/** 管理者による社員アカウント作成・パスワード再設定で使う（Better Auth の内部アダプター経由） */
export async function createCredentialUser(env: Env, input: { name: string; email: string; password: string }) {
  const ctx = await getAuth(env).$context;
  const user = await ctx.internalAdapter.createUser(
    { name: input.name, email: input.email.toLowerCase(), emailVerified: true },
    { method: "admin" },
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await hashPassword(input.password),
  });
  return user;
}

export async function setUserPassword(env: Env, userId: string, password: string) {
  const db = getDb(env.DB);
  const hash = await hashPassword(password);
  await db.batch([
    db
      .update(schema.accounts)
      .set({ password: hash, updatedAt: new Date() })
      .where(and(eq(schema.accounts.userId, userId), eq(schema.accounts.providerId, "credential"))),
    db.delete(schema.sessions).where(eq(schema.sessions.userId, userId)),
  ]);
}
