import { eq, sql } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import type { Role } from "../../../shared/types";
import { getAuth } from "../auth";
import { getDb, schema, type DB } from "./db";
import { HttpError, forbidden } from "./http";

export type AuthContext = {
  userId: string;
  userName: string;
  email: string;
  sessionId: string;
  organizationId: string;
  organizationName: string;
  role: Role;
};

export type AppEnv = {
  Bindings: Env;
  Variables: { db: DB; auth: AuthContext };
};

export type AppContext = Context<AppEnv>;

/**
 * セッションを検証し、所属企業と権限をサーバー側で確定する。
 * 企業ID はここで決めた値だけを使い、リクエストに含まれる値は一切使わない。
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await getAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!session) throw new HttpError(401, "unauthenticated", "ログインの有効期限が切れました。再度ログインしてください");

  const db = c.get("db");
  const m = await db
    .select({
      organizationId: schema.organizationMemberships.organizationId,
      role: schema.organizationMemberships.role,
      status: schema.organizationMemberships.status,
      orgName: sql<string>`${schema.organizations.name}`.as("org_name"),
      orgStatus: sql<"active" | "suspended">`${schema.organizations.status}`.as("org_status"),
    })
    .from(schema.organizationMemberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.organizationMemberships.organizationId))
    .where(eq(schema.organizationMemberships.userId, session.user.id))
    .get();
  if (!m || m.status !== "active") throw new HttpError(403, "membership_inactive", "このアカウントは利用できません。管理者にお問い合わせください");
  if (m.orgStatus !== "active") throw new HttpError(403, "organization_suspended", "ご契約の企業は現在ご利用いただけません");

  c.set("auth", {
    userId: session.user.id,
    userName: session.user.name,
    email: session.user.email,
    sessionId: session.session.id,
    organizationId: m.organizationId,
    organizationName: m.orgName,
    role: m.role,
  });

  // API 全体のレート制限（ユーザー単位）
  if (c.env.API_RATE_LIMITER) {
    const { success } = await c.env.API_RATE_LIMITER.limit({ key: session.user.id });
    if (!success) throw new HttpError(429, "rate_limited", "操作が集中しています。少し待ってから再度お試しください");
  }
  await next();
};

export function requireAdmin(c: AppContext): AuthContext {
  const auth = c.get("auth");
  if (auth.role !== "admin") throw forbidden("この操作は管理者のみ行えます");
  return auth;
}

/** 価格表を編集できるか（管理者、または企業設定で一般社員の編集を許可している場合） */
export async function canEditPrices(c: AppContext): Promise<boolean> {
  const auth = c.get("auth");
  if (auth.role === "admin") return true;
  const row = await c
    .get("db")
    .select({ v: schema.organizationSettings.memberCanEditPrices })
    .from(schema.organizationSettings)
    .where(eq(schema.organizationSettings.organizationId, auth.organizationId))
    .get();
  return !!row?.v;
}

export async function requirePriceEditor(c: AppContext): Promise<AuthContext> {
  if (!(await canEditPrices(c))) throw forbidden("価格表を編集する権限がありません（管理者にお問い合わせください）");
  return c.get("auth");
}

export function dbMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set("db", getDb(c.env.DB));
    await next();
  };
}

