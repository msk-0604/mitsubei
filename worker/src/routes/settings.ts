import { and, asc, eq, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Me, Member, OrganizationSettings } from "../../../shared/types";
import { createCredentialUser, setUserPassword } from "../auth";
import { auditStmt } from "../lib/audit";
import { canEditPrices, requireAdmin, type AppContext, type AppEnv } from "../lib/context";
import { schema, type DB } from "../lib/db";
import { HttpError, isUniqueViolation, newId, notFound, nowIso } from "../lib/http";
import { parseBody } from "../lib/request";
import { idSchema, memberCreateInput, memberPasswordInput, memberUpdateInput, settingsInput } from "../schemas";
import { loadSettings } from "./estimates";

const s = schema.organizationSettings;
const m = schema.organizationMemberships;

function toSettings(r: typeof s.$inferSelect): OrganizationSettings {
  return {
    companyName: r.companyName,
    postalCode: r.postalCode,
    address: r.address,
    phone: r.phone,
    email: r.email,
    bankInfo: r.bankInfo,
    registrationNumber: r.registrationNumber,
    logoId: r.logoId,
    numberPrefix: r.numberPrefix,
    numberDigits: r.numberDigits,
    numberReset: r.numberReset,
    amountRounding: r.amountRounding,
    taxRounding: r.taxRounding,
    defaultNotes: r.defaultNotes,
    defaultValidDays: r.defaultValidDays,
    memberCanEditPrices: r.memberCanEditPrices,
    updatedAt: r.updatedAt,
  };
}

/* ───────────── ログイン中のユーザー ───────────── */

export const me = new Hono<AppEnv>();

me.get("/", async (ctx) => {
  const auth = ctx.get("auth");
  const body: Me = {
    user: { id: auth.userId, name: auth.userName, email: auth.email },
    organization: { id: auth.organizationId, name: auth.organizationName },
    role: auth.role,
    permissions: {
      editPrices: await canEditPrices(ctx),
      manageSettings: auth.role === "admin",
      manageMembers: auth.role === "admin",
    },
  };
  return ctx.json(body);
});

/* ───────────── 企業設定 ───────────── */

export const settings = new Hono<AppEnv>();

settings.get("/", async (ctx) => ctx.json(toSettings(await loadSettings(ctx))));

settings.put("/", async (ctx) => {
  const auth = requireAdmin(ctx);
  const db = ctx.get("db");
  const input = await parseBody(ctx, settingsInput);
  const [rows] = await db.batch([
    db
      .update(s)
      .set({ ...input, updatedAt: nowIso(), updatedBy: auth.userId })
      .where(eq(s.organizationId, auth.organizationId))
      .returning(),
    db.update(schema.organizations).set({ name: input.companyName, updatedAt: nowIso() }).where(eq(schema.organizations.id, auth.organizationId)),
    auditStmt(db, auth, "settings.update", "organization", auth.organizationId),
  ]);
  return ctx.json(toSettings(rows[0]!));
});

const MAX_LOGO_BYTES = 300 * 1024;

/** 画像の形式と大きさを中身（先頭のバイト列）から判定する。拡張子や Content-Type は信用しない */
export function inspectImage(b: Uint8Array): { mime: "image/png" | "image/jpeg"; width: number; height: number } | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length > 24 && png.every((v, i) => b[i] === v)) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { mime: "image/png", width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      const len = (b[i + 2]! << 8) | b[i + 3]!;
      // SOF0〜SOF15（DHT・JPG・DAC を除く）に画像サイズがある
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { mime: "image/jpeg", height: (b[i + 5]! << 8) | b[i + 6]!, width: (b[i + 7]! << 8) | b[i + 8]! };
      }
      i += 2 + len;
    }
  }
  return null;
}

settings.post("/logo", async (ctx) => {
  const auth = requireAdmin(ctx);
  const db = ctx.get("db");
  const len = Number(ctx.req.header("content-length") ?? "0");
  if (len > MAX_LOGO_BYTES) throw new HttpError(413, "logo_too_large", "ロゴ画像は300KB以下にしてください");
  const bytes = new Uint8Array(await ctx.req.arrayBuffer());
  if (bytes.length === 0) throw new HttpError(400, "logo_empty", "画像を選択してください");
  if (bytes.length > MAX_LOGO_BYTES) throw new HttpError(413, "logo_too_large", "ロゴ画像は300KB以下にしてください");
  const info = inspectImage(bytes);
  if (!info) throw new HttpError(400, "logo_invalid", "PNG または JPEG の画像を選択してください");
  if (info.width < 1 || info.height < 1 || info.width > 4000 || info.height > 4000) {
    throw new HttpError(400, "logo_invalid", "画像の大きさは縦横4000ピクセル以内にしてください");
  }
  const id = newId();
  // 古いロゴは削除しない（発行済みの見積書が発行時点のロゴを参照するため）
  await db.batch([
    db.insert(schema.organizationLogos).values({
      id,
      organizationId: auth.organizationId,
      mime: info.mime,
      data: bytes as unknown as typeof schema.organizationLogos.$inferInsert.data,
      size: bytes.length,
      width: info.width,
      height: info.height,
    }),
    db.update(s).set({ logoId: id, updatedAt: nowIso(), updatedBy: auth.userId }).where(eq(s.organizationId, auth.organizationId)),
    auditStmt(db, auth, "settings.logo", "organization", auth.organizationId, { size: bytes.length }),
  ]);
  return ctx.json({ logoId: id });
});

settings.delete("/logo", async (ctx) => {
  const auth = requireAdmin(ctx);
  const db = ctx.get("db");
  await db.batch([
    db.update(s).set({ logoId: null, updatedAt: nowIso(), updatedBy: auth.userId }).where(eq(s.organizationId, auth.organizationId)),
    auditStmt(db, auth, "settings.logo_remove", "organization", auth.organizationId),
  ]);
  return ctx.json({ ok: true });
});

/** ロゴ画像（自社のものだけ）。ID ごとに内容は変わらないため長めにキャッシュ（private：共有キャッシュには載せない） */
export const logos = new Hono<AppEnv>();
logos.get("/:id", async (ctx) => {
  const id = ctx.req.param("id");
  if (!idSchema.safeParse(id).success) throw notFound();
  const row = await ctx
    .get("db")
    .select({ mime: schema.organizationLogos.mime, data: schema.organizationLogos.data })
    .from(schema.organizationLogos)
    .where(and(eq(schema.organizationLogos.id, id), eq(schema.organizationLogos.organizationId, ctx.get("auth").organizationId)))
    .get();
  if (!row) throw notFound();
  return new Response(row.data as unknown as ArrayBuffer, {
    headers: { "content-type": row.mime, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" },
  });
});

/* ───────────── 社員（管理者のみ） ───────────── */

export const members = new Hono<AppEnv>();

async function listMembers(db: DB, organizationId: string): Promise<Member[]> {
  const rows = await db
    .select({
      id: m.id,
      userId: m.userId,
      name: schema.users.name,
      email: schema.users.email,
      role: m.role,
      status: m.status,
      createdAt: m.createdAt,
    })
    .from(m)
    .innerJoin(schema.users, eq(schema.users.id, m.userId))
    .where(eq(m.organizationId, organizationId))
    .orderBy(asc(m.createdAt));
  return rows;
}

members.get("/", async (ctx) => {
  const auth = requireAdmin(ctx);
  return ctx.json({ items: await listMembers(ctx.get("db"), auth.organizationId) });
});

members.post("/", async (ctx) => {
  const auth = requireAdmin(ctx);
  const db = ctx.get("db");
  const input = await parseBody(ctx, memberCreateInput);
  const exists = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, input.email.toLowerCase())).get();
  if (exists) throw new HttpError(409, "duplicate_email", "このメールアドレスはすでに登録されています", { email: "このメールアドレスはすでに登録されています" });
  let userId: string;
  try {
    const user = await createCredentialUser(ctx.env, input);
    userId = user.id;
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, "duplicate_email", "このメールアドレスはすでに登録されています", { email: "このメールアドレスはすでに登録されています" });
    throw err;
  }
  try {
    await db.batch([
      db.insert(m).values({ id: newId(), organizationId: auth.organizationId, userId, role: input.role }),
      auditStmt(db, auth, "member.create", "member", userId, { role: input.role }),
    ]);
  } catch (err) {
    // 所属の作成に失敗したら、作ったユーザーを消して元に戻す
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    throw err;
  }
  return ctx.json({ items: await listMembers(db, auth.organizationId) }, 201);
});

async function findMember(ctx: AppContext, organizationId: string) {
  const id = ctx.req.param("id") ?? "";
  if (!idSchema.safeParse(id).success) throw notFound();
  const row = await ctx
    .get("db")
    .select()
    .from(m)
    .where(and(eq(m.id, id), eq(m.organizationId, organizationId)))
    .get();
  if (!row) throw notFound();
  return row;
}

members.patch("/:id", async (ctx) => {
  const auth = requireAdmin(ctx);
  const db = ctx.get("db");
  const target = await findMember(ctx, auth.organizationId);
  const input = await parseBody(ctx, memberUpdateInput);
  if (target.userId === auth.userId && ((input.role && input.role !== "admin") || input.status === "disabled")) {
    throw new HttpError(400, "self_change", "自分自身の権限変更・無効化はできません");
  }
  // 有効な管理者が1人もいなくならないようにする
  if ((input.role === "member" || input.status === "disabled") && target.role === "admin") {
    const others = await db
      .select({ n: sql<number>`count(*)` })
      .from(m)
      .where(and(eq(m.organizationId, auth.organizationId), eq(m.role, "admin"), eq(m.status, "active"), ne(m.id, target.id)))
      .get();
    if ((others?.n ?? 0) === 0) throw new HttpError(400, "last_admin", "管理者が1人もいなくなるため変更できません");
  }
  const stmts = [
    db
      .update(m)
      .set({ ...(input.role ? { role: input.role } : {}), ...(input.status ? { status: input.status } : {}), updatedAt: nowIso() })
      .where(and(eq(m.id, target.id), eq(m.organizationId, auth.organizationId))),
    auditStmt(db, auth, "member.update", "member", target.userId, { role: input.role ?? null, status: input.status ?? null }),
  ] as const;
  const extra = [];
  if (input.name) extra.push(db.update(schema.users).set({ name: input.name, updatedAt: new Date() }).where(eq(schema.users.id, target.userId)));
  // 無効化したら、その人のログイン中のセッションをすべて終了する
  if (input.status === "disabled") extra.push(db.delete(schema.sessions).where(eq(schema.sessions.userId, target.userId)));
  await db.batch([...stmts, ...extra] as unknown as Parameters<typeof db.batch>[0]);
  return ctx.json({ items: await listMembers(db, auth.organizationId) });
});

/** 管理者による社員のパスワード再設定（その社員のセッションはすべて終了） */
members.post("/:id/password", async (ctx) => {
  const auth = requireAdmin(ctx);
  const db = ctx.get("db");
  const target = await findMember(ctx, auth.organizationId);
  const { password } = await parseBody(ctx, memberPasswordInput);
  await setUserPassword(ctx.env, target.userId, password);
  await auditStmt(db, auth, "member.password_reset", "member", target.userId);
  return ctx.json({ ok: true });
});

/* ───────────── 操作ログ（管理者のみ） ───────────── */

export const auditLogs = new Hono<AppEnv>();
auditLogs.get("/", async (ctx) => {
  const auth = requireAdmin(ctx);
  const db = ctx.get("db");
  const rows = await db
    .select({
      id: schema.auditLogs.id,
      action: schema.auditLogs.action,
      entityType: schema.auditLogs.entityType,
      entityId: schema.auditLogs.entityId,
      detail: schema.auditLogs.detail,
      createdAt: schema.auditLogs.createdAt,
      userName: schema.users.name,
    })
    .from(schema.auditLogs)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.userId))
    .where(eq(schema.auditLogs.organizationId, auth.organizationId))
    .orderBy(sql`${schema.auditLogs.createdAt} DESC`)
    .limit(200);
  return ctx.json({ items: rows });
});
