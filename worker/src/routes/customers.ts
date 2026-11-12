import { and, asc, count, eq, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Customer } from "../../../shared/types";
import { auditStmt } from "../lib/audit";
import type { AppContext, AppEnv } from "../lib/context";
import { schema } from "../lib/db";
import { HttpError, isUniqueViolation, likePattern, newId, notFound, nowIso } from "../lib/http";
import { parseBody, parseQuery } from "../lib/request";
import { customerInput, idSchema, pageQuery } from "../schemas";

const c = schema.customers;
type Row = typeof c.$inferSelect;

export function toCustomer(r: Row): Customer {
  return {
    id: r.id,
    name: r.name,
    honorific: r.honorific,
    contactName: r.contactName,
    phone: r.phone,
    email: r.email,
    postalCode: r.postalCode,
    address: r.address,
    notes: r.notes,
    telkalCustomerId: r.telkalCustomerId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export const customers = new Hono<AppEnv>();

customers.get("/", async (ctx) => {
  const { organizationId } = ctx.get("auth");
  const db = ctx.get("db");
  const q = parseQuery(ctx, pageQuery.extend({ q: z.string().trim().max(100).default("") }));
  const conds = [eq(c.organizationId, organizationId), isNull(c.archivedAt)];
  if (q.q) {
    const p = likePattern(q.q);
    conds.push(
      or(
        sql`${c.name} LIKE ${p} ESCAPE '\\'`,
        sql`${c.contactName} LIKE ${p} ESCAPE '\\'`,
        sql`${c.phone} LIKE ${p} ESCAPE '\\'`,
      )!,
    );
  }
  const where = and(...conds);
  const [rows, total] = await db.batch([
    db
      .select()
      .from(c)
      .where(where)
      .orderBy(asc(c.name))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: count() }).from(c).where(where),
  ]);
  return ctx.json({ items: rows.map(toCustomer), total: total[0]?.n ?? 0, page: q.page, pageSize: q.pageSize });
});

customers.post("/", async (ctx) => {
  const auth = ctx.get("auth");
  const db = ctx.get("db");
  const input = await parseBody(ctx, customerInput);
  const id = newId();
  try {
    const [rows] = await db.batch([
      db
        .insert(c)
        .values({ id, organizationId: auth.organizationId, ...input })
        .returning(),
      auditStmt(db, auth, "customer.create", "customer", id),
    ]);
    return ctx.json(toCustomer(rows[0]!), 201);
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, "duplicate", "同じ TELKAL 顧客ID の顧客がすでに登録されています");
    throw e;
  }
});

async function findCustomer(ctx: AppContext, id: string) {
  if (!idSchema.safeParse(id).success) throw notFound();
  const row = await ctx
    .get("db")
    .select()
    .from(c)
    .where(and(eq(c.id, id), eq(c.organizationId, ctx.get("auth").organizationId), isNull(c.archivedAt)))
    .get();
  if (!row) throw notFound();
  return row;
}

customers.get("/:id", async (ctx) => ctx.json(toCustomer(await findCustomer(ctx, ctx.req.param("id")))));

customers.patch("/:id", async (ctx) => {
  const auth = ctx.get("auth");
  const db = ctx.get("db");
  const row = await findCustomer(ctx, ctx.req.param("id"));
  const input = await parseBody(ctx, customerInput);
  try {
    const [rows] = await db.batch([
      db
        .update(c)
        .set({ ...input, updatedAt: nowIso() })
        .where(and(eq(c.id, row.id), eq(c.organizationId, auth.organizationId)))
        .returning(),
      auditStmt(db, auth, "customer.update", "customer", row.id),
    ]);
    // 発行済みの見積書は recipient_* に発行時点の宛先を持つため、ここでの変更は反映されない
    return ctx.json(toCustomer(rows[0]!));
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, "duplicate", "同じ TELKAL 顧客ID の顧客がすでに登録されています");
    throw e;
  }
});

/** 顧客の削除（見積書から参照されるため、行は残して非表示にする） */
customers.delete("/:id", async (ctx) => {
  const auth = ctx.get("auth");
  const db = ctx.get("db");
  const row = await findCustomer(ctx, ctx.req.param("id"));
  await db.batch([
    db
      .update(c)
      .set({ archivedAt: nowIso(), updatedAt: nowIso() })
      .where(and(eq(c.id, row.id), eq(c.organizationId, auth.organizationId))),
    auditStmt(db, auth, "customer.archive", "customer", row.id),
  ]);
  return ctx.json({ ok: true });
});
