import { and, asc, count, desc, eq, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { PRICE_SCALE, TAX_CATEGORIES, formatDecimal, type TaxCategory } from "../../../shared/calc";
import type { PriceCategory, PriceItem } from "../../../shared/types";
import { auditStmt } from "../lib/audit";
import { requirePriceEditor, type AppContext, type AppEnv } from "../lib/context";
import { schema } from "../lib/db";
import { HttpError, isUniqueViolation, likePattern, newId, notFound, nowIso } from "../lib/http";
import { parseBody, parseQuery } from "../lib/request";
import { idSchema, pageQuery, priceCategoryInput, priceImportInput, priceItemInput, unitPriceField } from "../schemas";

const pi = schema.priceItems;
const pc = schema.priceCategories;

type ItemRow = typeof pi.$inferSelect & { categoryName: string | null };

function toItem(r: ItemRow): PriceItem {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    spec: r.spec,
    unit: r.unit,
    unitPrice: formatDecimal(BigInt(r.unitPriceX100), PRICE_SCALE),
    taxCategory: r.taxCategory,
    notes: r.notes,
    isActive: r.isActive,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

const itemColumns = {
  id: pi.id,
  organizationId: pi.organizationId,
  code: pi.code,
  name: pi.name,
  categoryId: pi.categoryId,
  spec: pi.spec,
  unit: pi.unit,
  unitPriceX100: pi.unitPriceX100,
  taxCategory: pi.taxCategory,
  notes: pi.notes,
  isActive: pi.isActive,
  createdBy: pi.createdBy,
  updatedBy: pi.updatedBy,
  createdAt: pi.createdAt,
  updatedAt: pi.updatedAt,
  categoryName: sql<string | null>`${pc.name}`.as("category_name"),
};

async function assertCategory(ctx: AppContext, categoryId: string | null) {
  if (!categoryId) return;
  const row = await ctx
    .get("db")
    .select({ id: pc.id })
    .from(pc)
    .where(and(eq(pc.id, categoryId), eq(pc.organizationId, ctx.get("auth").organizationId)))
    .get();
  if (!row) throw new HttpError(400, "validation_error", "入力内容を確認してください", { categoryId: "カテゴリが見つかりません" });
}

function duplicateCode() {
  return new HttpError(409, "duplicate_code", "この商品コードはすでに使われています", { code: "この商品コードはすでに使われています" });
}

/* ───────────── カテゴリ ───────────── */

export const priceCategories = new Hono<AppEnv>();

priceCategories.get("/", async (ctx) => {
  const { organizationId } = ctx.get("auth");
  const db = ctx.get("db");
  const rows = await db
    .select({ id: pc.id, name: pc.name, sortOrder: pc.sortOrder, itemCount: sql<number>`count(${pi.id})` })
    .from(pc)
    .leftJoin(pi, and(eq(pi.categoryId, pc.id), eq(pi.organizationId, pc.organizationId)))
    .where(eq(pc.organizationId, organizationId))
    .groupBy(pc.id)
    .orderBy(asc(pc.sortOrder), asc(pc.name));
  return ctx.json({ items: rows satisfies PriceCategory[] });
});

priceCategories.post("/", async (ctx) => {
  const auth = await requirePriceEditor(ctx);
  const db = ctx.get("db");
  const input = await parseBody(ctx, priceCategoryInput);
  const id = newId();
  try {
    await db.batch([
      db.insert(pc).values({ id, organizationId: auth.organizationId, ...input }),
      auditStmt(db, auth, "price_category.create", "price_category", id),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, "duplicate", "同じ名前のカテゴリがあります", { name: "同じ名前のカテゴリがあります" });
    throw e;
  }
  return ctx.json({ id, ...input }, 201);
});

priceCategories.patch("/:id", async (ctx) => {
  const auth = await requirePriceEditor(ctx);
  const db = ctx.get("db");
  const id = ctx.req.param("id");
  if (!idSchema.safeParse(id).success) throw notFound();
  const input = await parseBody(ctx, priceCategoryInput);
  try {
    const [rows] = await db.batch([
      db
        .update(pc)
        .set(input)
        .where(and(eq(pc.id, id), eq(pc.organizationId, auth.organizationId)))
        .returning({ id: pc.id }),
      auditStmt(db, auth, "price_category.update", "price_category", id),
    ]);
    if (rows.length === 0) throw notFound();
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, "duplicate", "同じ名前のカテゴリがあります", { name: "同じ名前のカテゴリがあります" });
    throw e;
  }
  return ctx.json({ id, ...input });
});

/** カテゴリ削除：属する商品は「カテゴリなし」にする */
priceCategories.delete("/:id", async (ctx) => {
  const auth = await requirePriceEditor(ctx);
  const db = ctx.get("db");
  const id = ctx.req.param("id");
  if (!idSchema.safeParse(id).success) throw notFound();
  const [, deleted] = await db.batch([
    db
      .update(pi)
      .set({ categoryId: null, updatedAt: nowIso() })
      .where(and(eq(pi.categoryId, id), eq(pi.organizationId, auth.organizationId))),
    db
      .delete(pc)
      .where(and(eq(pc.id, id), eq(pc.organizationId, auth.organizationId)))
      .returning({ id: pc.id }),
    auditStmt(db, auth, "price_category.delete", "price_category", id),
  ]);
  if (deleted.length === 0) throw notFound();
  return ctx.json({ ok: true });
});

/* ───────────── 商品・工事項目 ───────────── */

export const priceItems = new Hono<AppEnv>();

const SORTS = {
  name: [asc(pi.name)],
  code: [sql`${pi.code} IS NULL`, asc(pi.code), asc(pi.name)],
  price_asc: [asc(pi.unitPriceX100), asc(pi.name)],
  price_desc: [desc(pi.unitPriceX100), asc(pi.name)],
  updated: [desc(pi.updatedAt)],
} as const;

const listQuery = pageQuery.extend({
  q: z.string().trim().max(100).default(""),
  categoryId: z.union([idSchema, z.literal("none"), z.literal("")]).default(""),
  sort: z.enum(Object.keys(SORTS) as [keyof typeof SORTS]).default("name"),
  active: z.enum(["active", "inactive", "all"]).default("active"),
});

priceItems.get("/", async (ctx) => {
  const { organizationId } = ctx.get("auth");
  const db = ctx.get("db");
  const q = parseQuery(ctx, listQuery);
  const conds = [eq(pi.organizationId, organizationId)];
  if (q.active !== "all") conds.push(eq(pi.isActive, q.active === "active"));
  if (q.categoryId === "none") conds.push(isNull(pi.categoryId));
  else if (q.categoryId) conds.push(eq(pi.categoryId, q.categoryId));
  if (q.q) {
    // 商品名・商品コード・規格の部分一致（スペース区切りは AND）
    for (const word of q.q.split(/[\s　]+/).filter(Boolean).slice(0, 5)) {
      const p = likePattern(word);
      conds.push(or(sql`${pi.name} LIKE ${p} ESCAPE '\\'`, sql`${pi.code} LIKE ${p} ESCAPE '\\'`, sql`${pi.spec} LIKE ${p} ESCAPE '\\'`)!);
    }
  }
  const where = and(...conds);
  const [rows, total] = await db.batch([
    db
      .select(itemColumns)
      .from(pi)
      .leftJoin(pc, and(eq(pc.id, pi.categoryId), eq(pc.organizationId, pi.organizationId)))
      .where(where)
      .orderBy(...SORTS[q.sort])
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: count() }).from(pi).where(where),
  ]);
  return ctx.json({ items: rows.map(toItem), total: total[0]?.n ?? 0, page: q.page, pageSize: q.pageSize });
});

async function getItem(ctx: AppContext, id: string): Promise<ItemRow> {
  if (!idSchema.safeParse(id).success) throw notFound();
  const row = await ctx
    .get("db")
    .select(itemColumns)
    .from(pi)
    .leftJoin(pc, and(eq(pc.id, pi.categoryId), eq(pc.organizationId, pi.organizationId)))
    .where(and(eq(pi.id, id), eq(pi.organizationId, ctx.get("auth").organizationId)))
    .get();
  if (!row) throw notFound();
  return row;
}

priceItems.get("/export", async (ctx) => {
  const { organizationId } = ctx.get("auth");
  const rows = await ctx
    .get("db")
    .select(itemColumns)
    .from(pi)
    .leftJoin(pc, and(eq(pc.id, pi.categoryId), eq(pc.organizationId, pi.organizationId)))
    .where(eq(pi.organizationId, organizationId))
    .orderBy(asc(pc.sortOrder), asc(pc.name), asc(pi.name));
  const header = ["商品コード", "商品名", "カテゴリ", "規格・仕様", "単位", "標準単価", "税区分", "備考", "状態", "登録日", "更新日"];
  const lines = [header, ...rows.map((r) => {
    const item = toItem(r);
    return [
      item.code ?? "",
      item.name,
      item.categoryName ?? "",
      item.spec ?? "",
      item.unit ?? "",
      item.unitPrice,
      TAX_CSV_LABELS[item.taxCategory],
      item.notes ?? "",
      item.isActive ? "有効" : "無効",
      item.createdAt.slice(0, 10),
      item.updatedAt.slice(0, 10),
    ];
  })];
  // Excel で文字化けしないよう UTF-8 の BOM を付ける
  const csv = "﻿" + lines.map((cols) => cols.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="price-list.csv"; filename*=UTF-8''${encodeURIComponent("MITUBEI_価格表.csv")}`,
      "cache-control": "no-store",
    },
  });
});

const TAX_CSV_LABELS: Record<TaxCategory, string> = { standard: "10%", reduced: "8%", exempt: "非課税" };

/** CSV の1セル（数式として解釈される先頭文字は ' でエスケープ：CSV インジェクション対策） */
function csvCell(v: string): string {
  let s = v;
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

priceItems.get("/:id", async (ctx) => ctx.json(toItem(await getItem(ctx, ctx.req.param("id")))));

priceItems.post("/", async (ctx) => {
  const auth = await requirePriceEditor(ctx);
  const db = ctx.get("db");
  const { unitPrice, ...input } = await parseBody(ctx, priceItemInput);
  await assertCategory(ctx, input.categoryId);
  const id = newId();
  try {
    await db.batch([
      db.insert(pi).values({
        id,
        organizationId: auth.organizationId,
        ...input,
        unitPriceX100: Number(unitPrice),
        createdBy: auth.userId,
        updatedBy: auth.userId,
      }),
      auditStmt(db, auth, "price_item.create", "price_item", id),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) throw duplicateCode();
    throw e;
  }
  return ctx.json(toItem(await getItem(ctx, id)), 201);
});

priceItems.patch("/:id", async (ctx) => {
  const auth = await requirePriceEditor(ctx);
  const db = ctx.get("db");
  const existing = await getItem(ctx, ctx.req.param("id"));
  const { unitPrice, ...input } = await parseBody(ctx, priceItemInput);
  await assertCategory(ctx, input.categoryId);
  try {
    // 見積明細には追加時点の単価を保存しているため、ここで単価を変えても過去の見積書は変わらない
    await db.batch([
      db
        .update(pi)
        .set({ ...input, unitPriceX100: Number(unitPrice), updatedBy: auth.userId, updatedAt: nowIso() })
        .where(and(eq(pi.id, existing.id), eq(pi.organizationId, auth.organizationId))),
      auditStmt(db, auth, "price_item.update", "price_item", existing.id),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) throw duplicateCode();
    throw e;
  }
  return ctx.json(toItem(await getItem(ctx, existing.id)));
});

priceItems.delete("/:id", async (ctx) => {
  const auth = await requirePriceEditor(ctx);
  const db = ctx.get("db");
  const existing = await getItem(ctx, ctx.req.param("id"));
  await db.batch([
    db.delete(pi).where(and(eq(pi.id, existing.id), eq(pi.organizationId, auth.organizationId))),
    auditStmt(db, auth, "price_item.delete", "price_item", existing.id),
  ]);
  return ctx.json({ ok: true });
});

/* ───────────── CSV 一括登録 ───────────── */

const TAX_ALIASES: Record<string, TaxCategory> = {
  "10": "standard",
  "10%": "standard",
  "標準": "standard",
  "課税": "standard",
  standard: "standard",
  "8": "reduced",
  "8%": "reduced",
  "軽減": "reduced",
  "8%（軽減）": "reduced",
  reduced: "reduced",
  "非課税": "exempt",
  "0": "exempt",
  "0%": "exempt",
  "対象外": "exempt",
  "不課税": "exempt",
  exempt: "exempt",
};

export function parseTaxCategory(v: string | null | undefined): TaxCategory | null {
  const s = (v ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s/g, "");
  if (s === "") return "standard";
  return TAX_ALIASES[s] ?? (TAX_CATEGORIES.includes(s as TaxCategory) ? (s as TaxCategory) : null);
}

const importRow = z.object({
  code: z.string().trim().max(50, { error: "商品コードは50文字以内" }).transform((v) => v || null),
  name: z.string().trim().min(1, { error: "商品名が空です" }).max(200, { error: "商品名は200文字以内" }),
  category: z.string().trim().max(50, { error: "カテゴリは50文字以内" }).transform((v) => v || null),
  spec: z.string().trim().max(200, { error: "規格は200文字以内" }).transform((v) => v || null),
  unit: z.string().trim().max(20, { error: "単位は20文字以内" }).transform((v) => v || null),
  unitPrice: unitPriceField,
  notes: z.string().trim().max(1000, { error: "備考は1000文字以内" }).transform((v) => v || null),
});

priceItems.post("/import", async (ctx) => {
  const auth = await requirePriceEditor(ctx);
  const db = ctx.get("db");
  const input = await parseBody(ctx, priceImportInput);

  // 1) 行ごとに検証（エラー行はまとめて返し、1件でもあれば何も登録しない）
  const errors: Array<{ row: number; message: string }> = [];
  const valid: Array<z.output<typeof importRow> & { taxCategory: TaxCategory; row: number }> = [];
  const seenCodes = new Map<string, number>();
  input.rows.forEach((raw, i) => {
    const rowNo = i + 1;
    const parsed = importRow.safeParse({
      code: raw.code ?? "",
      name: raw.name ?? "",
      category: raw.category ?? "",
      spec: raw.spec ?? "",
      unit: raw.unit ?? "",
      unitPrice: (raw.unitPrice ?? "").replace(/[円¥￥]/g, "") || "",
      notes: raw.notes ?? "",
    });
    const tax = parseTaxCategory(raw.taxCategory);
    if (!parsed.success) {
      errors.push({ row: rowNo, message: parsed.error.issues.map((x) => x.message).join("、") });
      return;
    }
    if (!tax) {
      errors.push({ row: rowNo, message: `税区分「${String(raw.taxCategory).slice(0, 10)}」が不明です（10% / 8% / 非課税）` });
      return;
    }
    if (parsed.data.code) {
      const prev = seenCodes.get(parsed.data.code);
      if (prev) {
        errors.push({ row: rowNo, message: `商品コード「${parsed.data.code}」が ${prev} 行目と重複しています` });
        return;
      }
      seenCodes.set(parsed.data.code, rowNo);
    }
    valid.push({ ...parsed.data, taxCategory: tax, row: rowNo });
  });
  if (errors.length > 0) {
    throw new HttpError(400, "import_invalid", `${errors.length}行に問題があります。修正してから再度取り込んでください`, {
      rows: errors.slice(0, 200),
    });
  }

  // 2) カテゴリ：未登録の名前は作成
  const existingCats = await db.select({ id: pc.id, name: pc.name }).from(pc).where(eq(pc.organizationId, auth.organizationId));
  const catByName = new Map(existingCats.map((r) => [r.name, r.id]));
  const newCats: Array<{ id: string; name: string }> = [];
  for (const r of valid) {
    if (r.category && !catByName.has(r.category)) {
      const id = newId();
      catByName.set(r.category, id);
      newCats.push({ id, name: r.category });
    }
  }

  // 3) 商品コードが既存と重複するもの（1クエリで確認）
  const codes = valid.map((r) => r.code).filter((v): v is string => !!v);
  const existingCodes = new Set<string>();
  if (codes.length > 0) {
    const { results } = await ctx.env.DB.prepare(
      `SELECT code FROM price_items WHERE organization_id = ?1 AND code IN (SELECT value FROM json_each(?2))`,
    )
      .bind(auth.organizationId, JSON.stringify(codes))
      .all<{ code: string }>();
    for (const r of results) existingCodes.add(r.code);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const rows: unknown[] = [];
  for (const r of valid) {
    if (r.code && existingCodes.has(r.code)) {
      if (input.onDuplicate === "skip") {
        skipped++;
        continue;
      }
      updated++;
    } else {
      created++;
    }
    rows.push({
      id: newId(),
      code: r.code,
      name: r.name,
      category_id: r.category ? catByName.get(r.category)! : null,
      spec: r.spec,
      unit: r.unit,
      price: Number(r.unitPrice),
      tax: r.taxCategory,
      notes: r.notes,
    });
  }

  // D1 の1リクエストあたりのクエリ数上限に収まるよう、JSON をまとめて渡して1文で登録・更新する。
  // batch は1つのトランザクションとして実行される（途中で失敗した場合はすべて取り消し）
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  if (newCats.length > 0) {
    stmts.push(
      ctx.env.DB.prepare(
        `INSERT INTO price_categories (id, organization_id, name, sort_order)
         SELECT json_extract(value, '$.id'), ?1, json_extract(value, '$.name'), 0 FROM json_each(?2)`,
      ).bind(auth.organizationId, JSON.stringify(newCats)),
    );
  }
  if (rows.length > 0) {
    stmts.push(
      ctx.env.DB.prepare(
        `INSERT INTO price_items
           (id, organization_id, code, name, category_id, spec, unit, unit_price_x100, tax_category, notes, is_active,
            created_by, updated_by, created_at, updated_at)
         SELECT json_extract(value, '$.id'), ?1, json_extract(value, '$.code'), json_extract(value, '$.name'),
                json_extract(value, '$.category_id'), json_extract(value, '$.spec'), json_extract(value, '$.unit'),
                json_extract(value, '$.price'), json_extract(value, '$.tax'), json_extract(value, '$.notes'), 1,
                ?2, ?2, ?3, ?3
           FROM json_each(?4) WHERE true
         ON CONFLICT (organization_id, code) DO UPDATE SET
           name = excluded.name, category_id = excluded.category_id, spec = excluded.spec, unit = excluded.unit,
           unit_price_x100 = excluded.unit_price_x100, tax_category = excluded.tax_category, notes = excluded.notes,
           is_active = 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      ).bind(auth.organizationId, auth.userId, now, JSON.stringify(rows)),
    );
  }
  const audit = auditStmt(ctx.get("db"), auth, "price_item.import", "price_item", null, { created, updated, skipped }).toSQL();
  stmts.push(ctx.env.DB.prepare(audit.sql).bind(...audit.params));
  await ctx.env.DB.batch(stmts);
  return ctx.json({ created, updated, skipped, categoriesCreated: newCats.length });
});
