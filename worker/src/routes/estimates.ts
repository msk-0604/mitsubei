import { and, asc, count, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  MAX_LINE_AMOUNT,
  PRICE_SCALE,
  QUANTITY_SCALE,
  computeTotals,
  formatDecimal,
  lineAmount,
  parseDecimal,
  type RoundingMode,
  type TaxCategory,
  type TaxGroup,
} from "../../../shared/calc";
import { addDays, formatEstimateNumber, numberPeriod, revisionNumberLabel, todayJst, type NumberReset } from "../../../shared/numbering";
import { ESTIMATE_STATUSES, type Estimate, type EstimateItem, type EstimateStatus, type EstimateSummary, type IssuerSnapshot } from "../../../shared/types";
import { auditStmt } from "../lib/audit";
import type { AppContext, AppEnv, AuthContext } from "../lib/context";
import { bytesToBase64 } from "../lib/crypto";
import { schema } from "../lib/db";
import { HttpError, forbidden, isUniqueViolation, likePattern, newId, notFound, nowIso } from "../lib/http";
import { parseBody, parseQuery } from "../lib/request";
import { estimateInput, estimateUpdateInput, idSchema, pageQuery, statusInput, versionInput } from "../schemas";

const e = schema.estimates;
const ei = schema.estimateItems;
type EstimateRow = typeof e.$inferSelect;
type ItemRow = typeof ei.$inferSelect;
type SettingsRow = typeof schema.organizationSettings.$inferSelect;

/* ───────────── 変換 ───────────── */

function toSummary(r: EstimateRow): EstimateSummary {
  return {
    id: r.id,
    estimateNumber: r.estimateNumber,
    status: r.status,
    issueDate: r.issueDate,
    validUntil: r.validUntil,
    recipientName: r.recipientName,
    recipientHonorific: r.recipientHonorific,
    subject: r.subject,
    subtotal: r.subtotalYen - r.discountYen,
    tax: r.taxYen,
    total: r.totalYen,
    revisionNumber: r.revisionNumber,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toItem(r: ItemRow): EstimateItem {
  return {
    id: r.id,
    priceItemId: r.priceItemId,
    name: r.name,
    spec: r.spec,
    quantity: formatDecimal(BigInt(r.quantityMilli), QUANTITY_SCALE),
    unit: r.unit,
    unitPrice: formatDecimal(BigInt(r.unitPriceX100), PRICE_SCALE),
    amount: r.amountYen,
    taxCategory: r.taxCategory,
    notes: r.notes,
  };
}

/* ───────────── 共通処理 ───────────── */

export async function loadSettings(ctx: AppContext): Promise<SettingsRow> {
  const row = await ctx
    .get("db")
    .select()
    .from(schema.organizationSettings)
    .where(eq(schema.organizationSettings.organizationId, ctx.get("auth").organizationId))
    .get();
  if (!row) throw new HttpError(500, "settings_missing", "企業設定が見つかりません");
  return row;
}

export function issuerFromSettings(s: SettingsRow): IssuerSnapshot {
  return {
    companyName: s.companyName,
    postalCode: s.postalCode,
    address: s.address,
    phone: s.phone,
    email: s.email,
    registrationNumber: s.registrationNumber,
    bankInfo: s.bankInfo,
    logoId: s.logoId,
    sealId: s.sealId,
    stampBoxes: parseStampBoxes(s.stampBoxes),
  };
}

export function parseStampBoxes(v: string | null | undefined): string[] {
  try {
    const a = JSON.parse(v ?? "[]") as unknown;
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string").slice(0, 4) : [];
  } catch {
    return [];
  }
}

type CalcInput = z.output<typeof estimateInput>;

/** 明細の金額と合計をサーバー側で計算し直す（画面から送られた金額は使わない） */
export function calculate(input: Pick<CalcInput, "items" | "discount">, amountRounding: RoundingMode, taxRounding: RoundingMode) {
  const items = input.items.map((it, i) => {
    const amount = lineAmount(it.quantity, it.unitPrice, amountRounding);
    if (amount > BigInt(MAX_LINE_AMOUNT) || amount < -BigInt(MAX_LINE_AMOUNT)) {
      throw new HttpError(400, "validation_error", "入力内容を確認してください", { [`items.${i}.unitPrice`]: "金額が大きすぎます" });
    }
    return { ...it, amount: Number(amount) };
  });
  const totals = computeTotals(items, input.discount, taxRounding);
  if (input.discount > 0 && totals.groups.reduce((a, g) => a + Math.max(0, g.subtotal), 0) < input.discount) {
    throw new HttpError(400, "validation_error", "入力内容を確認してください", { discount: "値引きが小計を超えています" });
  }
  return { items, totals };
}

/**
 * 見積書番号の自動採番（企業 × 期間ごとの連番）。
 * UPSERT + RETURNING は1文で実行されるため、同時に作成しても同じ番号は返らない。
 */
async function nextNumber(env: Env, organizationId: string, s: SettingsRow, issueDate: string): Promise<string> {
  const period = numberPeriod(s.numberReset as NumberReset, issueDate);
  const row = await env.DB.prepare(
    `INSERT INTO estimate_number_counters (organization_id, period, last_value) VALUES (?1, ?2, 1)
     ON CONFLICT (organization_id, period) DO UPDATE SET last_value = last_value + 1
     RETURNING last_value`,
  )
    .bind(organizationId, period)
    .first<{ last_value: number }>();
  return formatEstimateNumber(s.numberPrefix, s.numberDigits, row!.last_value, issueDate);
}

/** 採番のプレビュー（番号は消費しない） */
async function peekNumber(env: Env, organizationId: string, s: SettingsRow, issueDate: string): Promise<string> {
  const period = numberPeriod(s.numberReset as NumberReset, issueDate);
  const row = await env.DB.prepare(`SELECT last_value FROM estimate_number_counters WHERE organization_id = ?1 AND period = ?2`)
    .bind(organizationId, period)
    .first<{ last_value: number }>();
  return formatEstimateNumber(s.numberPrefix, s.numberDigits, (row?.last_value ?? 0) + 1, issueDate);
}

/**
 * バッチの先頭に置くガード：見積書が「指定バージョン・指定ステータス」でなければエラーを起こして
 * バッチ全体（= トランザクション）を取り消す。楽観ロックと発行済みの上書き防止に使う。
 */
const GUARD_ERROR = "MITUBEI_GUARD";
function guardStmt(env: Env, id: string, organizationId: string, version: number | null, statuses: EstimateStatus[]) {
  return env.DB.prepare(
    `SELECT CASE WHEN EXISTS (
        SELECT 1 FROM estimates
         WHERE id = ?1 AND organization_id = ?2 AND deleted_at IS NULL
           AND (?3 IS NULL OR version = ?3)
           AND status IN (SELECT value FROM json_each(?4))
      ) THEN 1 ELSE json('${GUARD_ERROR}') END AS ok`,
  ).bind(id, organizationId, version, JSON.stringify(statuses));
}
function isGuardError(err: unknown): boolean {
  let x: unknown = err;
  for (let i = 0; i < 4 && x; i++) {
    if (x instanceof Error && /malformed JSON/i.test(x.message)) return true;
    x = (x as { cause?: unknown }).cause;
  }
  return false;
}
function conflict(): HttpError {
  return new HttpError(
    409,
    "conflict",
    "ほかの人がこの見積書を更新したか、発行済みのため保存できませんでした。画面を開き直して最新の内容を確認してください",
  );
}

function itemsInsertStmt(env: Env, estimateId: string, organizationId: string, items: ReturnType<typeof calculate>["items"]) {
  const rows = items.map((it, i) => ({
    id: newId(),
    position: i,
    price_item_id: it.priceItemId,
    name: it.name,
    spec: it.spec,
    q: Number(it.quantity),
    unit: it.unit,
    p: Number(it.unitPrice),
    amount: it.amount,
    tax: it.taxCategory,
    notes: it.notes,
  }));
  return env.DB.prepare(
    `INSERT INTO estimate_items
       (id, estimate_id, organization_id, position, price_item_id, name, spec, quantity_milli, unit, unit_price_x100, amount_yen, tax_category, notes)
     SELECT json_extract(value, '$.id'), ?1, ?2, json_extract(value, '$.position'), json_extract(value, '$.price_item_id'),
            json_extract(value, '$.name'), json_extract(value, '$.spec'), json_extract(value, '$.q'), json_extract(value, '$.unit'),
            json_extract(value, '$.p'), json_extract(value, '$.amount'), json_extract(value, '$.tax'), json_extract(value, '$.notes')
       FROM json_each(?3)`,
  ).bind(estimateId, organizationId, JSON.stringify(rows));
}

function auditRaw(ctx: AppContext, auth: AuthContext, action: string, id: string | null, detail?: Record<string, string | number | null>) {
  const q = auditStmt(ctx.get("db"), auth, action, "estimate", id, detail).toSQL();
  return ctx.env.DB.prepare(q.sql).bind(...q.params);
}

async function assertCustomer(ctx: AppContext, customerId: string | null) {
  if (!customerId) return;
  const row = await ctx
    .get("db")
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(and(eq(schema.customers.id, customerId), eq(schema.customers.organizationId, ctx.get("auth").organizationId)))
    .get();
  if (!row) throw new HttpError(400, "validation_error", "入力内容を確認してください", { customerId: "顧客が見つかりません" });
}

async function getRow(ctx: AppContext, id: string): Promise<EstimateRow> {
  if (!idSchema.safeParse(id).success) throw notFound();
  const row = await ctx
    .get("db")
    .select()
    .from(e)
    .where(and(eq(e.id, id), eq(e.organizationId, ctx.get("auth").organizationId), isNull(e.deletedAt)))
    .get();
  if (!row) throw notFound();
  return row;
}

async function loadEstimate(ctx: AppContext, id: string): Promise<Estimate> {
  const db = ctx.get("db");
  const { organizationId } = ctx.get("auth");
  const row = await getRow(ctx, id);
  const root = row.rootEstimateId ?? row.id;
  const [items, series, creator] = await db.batch([
    db
      .select()
      .from(ei)
      .where(and(eq(ei.estimateId, row.id), eq(ei.organizationId, organizationId)))
      .orderBy(asc(ei.position)),
    db
      .select({ id: e.id, estimateNumber: e.estimateNumber, revisionNumber: e.revisionNumber, status: e.status, updatedAt: e.updatedAt })
      .from(e)
      .where(and(eq(e.organizationId, organizationId), isNull(e.deletedAt), or(eq(e.id, root), eq(e.rootEstimateId, root))))
      .orderBy(asc(e.revisionNumber)),
    db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, row.createdBy ?? "")),
  ]);
  return {
    ...toSummary(row),
    customerId: row.customerId,
    recipientContact: row.recipientContact,
    recipientAddress: row.recipientAddress,
    projectName: row.projectName,
    projectLocation: row.projectLocation,
    notes: row.notes,
    discount: row.discountYen,
    itemsSubtotal: row.subtotalYen,
    taxGroups: JSON.parse(row.taxSummary) as TaxGroup[],
    amountRounding: row.amountRounding,
    taxRounding: row.taxRounding,
    issuer: row.issuerSnapshot ? (JSON.parse(row.issuerSnapshot) as IssuerSnapshot) : null,
    rootEstimateId: row.rootEstimateId,
    revisedFromId: row.revisedFromId,
    issuedAt: row.issuedAt,
    version: row.version,
    createdByName: creator[0]?.name ?? null,
    items: items.map(toItem),
    revisions: series.length > 1 ? series : [],
  };
}

/** 新しい下書きを保存する（番号が重複した場合、自動採番なら振り直す） */
async function insertDraft(
  ctx: AppContext,
  input: CalcInput,
  extra: { rootEstimateId?: string | null; revisionNumber?: number; revisedFromId?: string | null; duplicatedFromId?: string | null; fixedNumber?: string },
): Promise<string> {
  const auth = ctx.get("auth");
  const settings = await loadSettings(ctx);
  await assertCustomer(ctx, input.customerId);
  const { items, totals } = calculate(input, settings.amountRounding, settings.taxRounding);
  const manual = extra.fixedNumber ?? input.estimateNumber;

  for (let attempt = 0; attempt < 5; attempt++) {
    const number = manual ?? (await nextNumber(ctx.env, auth.organizationId, settings, input.issueDate));
    const id = newId();
    const now = nowIso();
    try {
      await ctx.env.DB.batch([
        ctx.env.DB.prepare(
          `INSERT INTO estimates
             (id, organization_id, estimate_number, status, issue_date, valid_until, customer_id, recipient_name, recipient_honorific,
              recipient_contact, recipient_address, subject, project_name, project_location, notes, discount_yen, subtotal_yen, tax_yen,
              total_yen, tax_summary, amount_rounding, tax_rounding, root_estimate_id, revision_number, revised_from_id, duplicated_from_id,
              created_by, updated_by, version, created_at, updated_at)
           VALUES (?1, ?2, ?3, 'draft', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?26, 1, ?27, ?27)`,
        ).bind(
          id,
          auth.organizationId,
          number,
          input.issueDate,
          input.validUntil,
          input.customerId,
          input.recipientName,
          input.recipientHonorific,
          input.recipientContact,
          input.recipientAddress,
          input.subject,
          input.projectName,
          input.projectLocation,
          input.notes,
          totals.discount,
          totals.subtotal,
          totals.tax,
          totals.total,
          JSON.stringify(totals.groups),
          settings.amountRounding,
          settings.taxRounding,
          extra.rootEstimateId ?? null,
          extra.revisionNumber ?? 0,
          extra.revisedFromId ?? null,
          extra.duplicatedFromId ?? null,
          auth.userId,
          now,
        ),
        itemsInsertStmt(ctx.env, id, auth.organizationId, items),
        auditRaw(ctx, auth, extra.revisedFromId ? "estimate.revise" : extra.duplicatedFromId ? "estimate.duplicate" : "estimate.create", id, {
          number,
          items: items.length,
        }),
      ]);
      return id;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      if (manual) {
        throw new HttpError(409, "duplicate_number", "この見積書番号はすでに使われています", { estimateNumber: "この見積書番号はすでに使われています" });
      }
      // 手入力で先に使われていた番号に当たった場合は、次の番号で再試行
    }
  }
  throw new HttpError(409, "number_exhausted", "見積書番号を採番できませんでした。番号を手入力してください");
}

function inputFromEstimate(src: Estimate): CalcInput {
  return {
    estimateNumber: null,
    issueDate: src.issueDate,
    validUntil: src.validUntil,
    customerId: src.customerId,
    recipientName: src.recipientName,
    recipientHonorific: src.recipientHonorific,
    recipientContact: src.recipientContact,
    recipientAddress: src.recipientAddress,
    subject: src.subject,
    projectName: src.projectName,
    projectLocation: src.projectLocation,
    notes: src.notes,
    discount: src.discount,
    items: src.items.map((it) => ({
      priceItemId: it.priceItemId,
      name: it.name,
      spec: it.spec,
      quantity: parseDecimal(it.quantity, QUANTITY_SCALE)!,
      unit: it.unit,
      unitPrice: parseDecimal(it.unitPrice, PRICE_SCALE)!,
      taxCategory: it.taxCategory as TaxCategory,
      notes: it.notes,
    })),
  };
}

/* ───────────── ルート ───────────── */

export const estimates = new Hono<AppEnv>();

const listQuery = pageQuery.extend({
  q: z.string().trim().max(100).default(""),
  status: z.union([z.enum(ESTIMATE_STATUSES), z.literal("")]).default(""),
  from: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).default(""),
  to: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).default(""),
  sort: z.enum(["issue_desc", "issue_asc", "updated_desc", "total_desc", "number_desc"]).default("issue_desc"),
});

const SORTS = {
  issue_desc: [desc(e.issueDate), desc(e.createdAt)],
  issue_asc: [asc(e.issueDate), asc(e.createdAt)],
  updated_desc: [desc(e.updatedAt)],
  total_desc: [desc(e.totalYen)],
  number_desc: [desc(e.estimateNumber)],
} as const;

estimates.get("/", async (ctx) => {
  const { organizationId } = ctx.get("auth");
  const db = ctx.get("db");
  const q = parseQuery(ctx, listQuery);
  const conds = [eq(e.organizationId, organizationId), isNull(e.deletedAt)];
  if (q.status) conds.push(eq(e.status, q.status));
  if (q.from) conds.push(gte(e.issueDate, q.from));
  if (q.to) conds.push(lte(e.issueDate, q.to));
  for (const word of q.q.split(/[\s　]+/).filter(Boolean).slice(0, 5)) {
    const p = likePattern(word);
    conds.push(
      or(
        sql`${e.estimateNumber} LIKE ${p} ESCAPE '\\'`,
        sql`${e.recipientName} LIKE ${p} ESCAPE '\\'`,
        sql`${e.subject} LIKE ${p} ESCAPE '\\'`,
        sql`${e.projectName} LIKE ${p} ESCAPE '\\'`,
      )!,
    );
  }
  const where = and(...conds);
  const [rows, total] = await db.batch([
    db
      .select()
      .from(e)
      .where(where)
      .orderBy(...SORTS[q.sort])
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: count() }).from(e).where(where),
  ]);
  return ctx.json({ items: rows.map(toSummary), total: total[0]?.n ?? 0, page: q.page, pageSize: q.pageSize });
});

/** 新規作成画面の初期値（採番プレビュー・有効期限・備考の初期値） */
estimates.get("/defaults", async (ctx) => {
  const settings = await loadSettings(ctx);
  const issueDate = todayJst();
  return ctx.json({
    estimateNumberPreview: await peekNumber(ctx.env, ctx.get("auth").organizationId, settings, issueDate),
    issueDate,
    validUntil: addDays(issueDate, settings.defaultValidDays),
    notes: settings.defaultNotes,
    amountRounding: settings.amountRounding,
    taxRounding: settings.taxRounding,
  });
});

estimates.post("/", async (ctx) => {
  const input = await parseBody(ctx, estimateInput);
  const id = await insertDraft(ctx, input, {});
  return ctx.json(await loadEstimate(ctx, id), 201);
});

estimates.get("/:id", async (ctx) => ctx.json(await loadEstimate(ctx, ctx.req.param("id"))));

/** 下書きの保存（発行済みは上書き不可。改訂版を作成する） */
estimates.put("/:id", async (ctx) => {
  const auth = ctx.get("auth");
  const row = await getRow(ctx, ctx.req.param("id"));
  if (row.status !== "draft") {
    throw new HttpError(409, "locked", "発行済みの見積書は編集できません。「改訂版を作成」から変更してください");
  }
  const input = await parseBody(ctx, estimateUpdateInput);
  const settings = await loadSettings(ctx);
  await assertCustomer(ctx, input.customerId);
  const { items, totals } = calculate(input, settings.amountRounding, settings.taxRounding);
  const number = input.estimateNumber ?? row.estimateNumber;
  try {
    await ctx.env.DB.batch([
      guardStmt(ctx.env, row.id, auth.organizationId, input.version, ["draft"]),
      ctx.env.DB.prepare(
        `UPDATE estimates SET estimate_number = ?3, issue_date = ?4, valid_until = ?5, customer_id = ?6, recipient_name = ?7,
           recipient_honorific = ?8, recipient_contact = ?9, recipient_address = ?10, subject = ?11, project_name = ?12,
           project_location = ?13, notes = ?14, discount_yen = ?15, subtotal_yen = ?16, tax_yen = ?17, total_yen = ?18,
           tax_summary = ?19, amount_rounding = ?20, tax_rounding = ?21, updated_by = ?22, updated_at = ?23, version = version + 1
         WHERE id = ?1 AND organization_id = ?2`,
      ).bind(
        row.id,
        auth.organizationId,
        number,
        input.issueDate,
        input.validUntil,
        input.customerId,
        input.recipientName,
        input.recipientHonorific,
        input.recipientContact,
        input.recipientAddress,
        input.subject,
        input.projectName,
        input.projectLocation,
        input.notes,
        totals.discount,
        totals.subtotal,
        totals.tax,
        totals.total,
        JSON.stringify(totals.groups),
        settings.amountRounding,
        settings.taxRounding,
        auth.userId,
        nowIso(),
      ),
      ctx.env.DB.prepare(`DELETE FROM estimate_items WHERE estimate_id = ?1 AND organization_id = ?2`).bind(row.id, auth.organizationId),
      itemsInsertStmt(ctx.env, row.id, auth.organizationId, items),
      auditRaw(ctx, auth, "estimate.update", row.id, { items: items.length }),
    ]);
  } catch (err) {
    if (isGuardError(err)) throw conflict();
    if (isUniqueViolation(err)) {
      throw new HttpError(409, "duplicate_number", "この見積書番号はすでに使われています", { estimateNumber: "この見積書番号はすでに使われています" });
    }
    throw err;
  }
  return ctx.json(await loadEstimate(ctx, row.id));
});

/** 発行：内容を確定し、自社情報と見積書全体のスナップショットを保存する */
estimates.post("/:id/issue", async (ctx) => {
  const auth = ctx.get("auth");
  const { version } = await parseBody(ctx, versionInput);
  const current = await loadEstimate(ctx, ctx.req.param("id"));
  if (current.status !== "draft") throw new HttpError(409, "already_issued", "この見積書はすでに発行済みです");
  const missing: Record<string, string> = {};
  if (!current.recipientName) missing.recipientName = "宛先を入力してください";
  if (!current.subject) missing.subject = "件名を入力してください";
  if (current.items.length === 0) missing.items = "明細を1行以上入力してください";
  if (Object.keys(missing).length > 0) throw new HttpError(400, "validation_error", "発行に必要な項目が入力されていません", missing);

  const settings = await loadSettings(ctx);
  const issuer = issuerFromSettings(settings);
  const now = nowIso();
  const snapshot = { ...current, status: "issued" as const, issuer, issuedAt: now };
  try {
    await ctx.env.DB.batch([
      guardStmt(ctx.env, current.id, auth.organizationId, version, ["draft"]),
      ctx.env.DB.prepare(
        `UPDATE estimates SET status = 'issued', issued_at = ?3, issuer_snapshot = ?4, updated_by = ?5, updated_at = ?3, version = version + 1
         WHERE id = ?1 AND organization_id = ?2`,
      ).bind(current.id, auth.organizationId, now, JSON.stringify(issuer), auth.userId),
      ctx.env.DB.prepare(
        `INSERT INTO estimate_revisions (id, organization_id, estimate_id, revision_number, event, status, snapshot, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, 'issued', 'issued', ?5, ?6, ?7)`,
      ).bind(newId(), auth.organizationId, current.id, current.revisionNumber, JSON.stringify(snapshot), auth.userId, now),
      auditRaw(ctx, auth, "estimate.issue", current.id, { number: current.estimateNumber }),
    ]);
  } catch (err) {
    if (isGuardError(err)) throw conflict();
    throw err;
  }
  return ctx.json(await loadEstimate(ctx, current.id));
});

/** ステータス変更（発行済み ⇄ 受注 / 失注）。内容は変わらない */
estimates.post("/:id/status", async (ctx) => {
  const auth = ctx.get("auth");
  const row = await getRow(ctx, ctx.req.param("id"));
  const { status } = await parseBody(ctx, statusInput);
  if (row.status === "draft") throw new HttpError(409, "not_issued", "下書きは先に発行してください");
  try {
    await ctx.env.DB.batch([
      guardStmt(ctx.env, row.id, auth.organizationId, null, ["issued", "won", "lost"]),
      ctx.env.DB.prepare(
        `UPDATE estimates SET status = ?3, updated_by = ?4, updated_at = ?5, version = version + 1 WHERE id = ?1 AND organization_id = ?2`,
      ).bind(row.id, auth.organizationId, status, auth.userId, nowIso()),
      auditRaw(ctx, auth, "estimate.status", row.id, { from: row.status, to: status }),
    ]);
  } catch (err) {
    if (isGuardError(err)) throw conflict();
    throw err;
  }
  return ctx.json(await loadEstimate(ctx, row.id));
});

/** 複製：新しい番号・今日の日付で下書きを作る（明細の単価は元の見積書の値をそのまま使う） */
estimates.post("/:id/duplicate", async (ctx) => {
  const src = await loadEstimate(ctx, ctx.req.param("id"));
  const settings = await loadSettings(ctx);
  const issueDate = todayJst();
  const input = { ...inputFromEstimate(src), issueDate, validUntil: addDays(issueDate, settings.defaultValidDays) };
  const id = await insertDraft(ctx, input, { duplicatedFromId: src.id });
  return ctx.json(await loadEstimate(ctx, id), 201);
});

/** 改訂版：発行済みの見積書を元に、同じ系列の下書き（番号-R1, -R2 …）を作る。元の見積書はそのまま残る */
estimates.post("/:id/revise", async (ctx) => {
  const auth = ctx.get("auth");
  const src = await loadEstimate(ctx, ctx.req.param("id"));
  if (src.status === "draft") throw new HttpError(409, "not_issued", "下書きはそのまま編集できます");
  const rootId = src.rootEstimateId ?? src.id;
  const db = ctx.get("db");
  const [root, maxRev] = await db.batch([
    db.select({ number: e.estimateNumber }).from(e).where(and(eq(e.id, rootId), eq(e.organizationId, auth.organizationId))),
    db
      .select({ n: sql<number>`max(${e.revisionNumber})` })
      .from(e)
      .where(and(eq(e.organizationId, auth.organizationId), or(eq(e.id, rootId), eq(e.rootEstimateId, rootId)))),
  ]);
  const revision = (maxRev[0]?.n ?? 0) + 1;
  const number = revisionNumberLabel(root[0]?.number ?? src.estimateNumber, revision);
  const input = { ...inputFromEstimate(src), issueDate: todayJst() };
  const id = await insertDraft(ctx, input, { rootEstimateId: rootId, revisionNumber: revision, revisedFromId: src.id, fixedNumber: number });
  return ctx.json(await loadEstimate(ctx, id), 201);
});

/** 削除（論理削除）。下書きは作成者または管理者、発行済み以降は管理者のみ */
estimates.delete("/:id", async (ctx) => {
  const auth = ctx.get("auth");
  const row = await getRow(ctx, ctx.req.param("id"));
  if (auth.role !== "admin" && !(row.status === "draft" && row.createdBy === auth.userId)) {
    throw forbidden(row.status === "draft" ? "ほかの人が作成した下書きは管理者のみ削除できます" : "発行済みの見積書は管理者のみ削除できます");
  }
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`UPDATE estimates SET deleted_at = ?3, updated_by = ?4 WHERE id = ?1 AND organization_id = ?2`).bind(
      row.id,
      auth.organizationId,
      nowIso(),
      auth.userId,
    ),
    auditRaw(ctx, auth, "estimate.delete", row.id, { number: row.estimateNumber, status: row.status }),
  ]);
  return ctx.json({ ok: true });
});

/** PDF 生成用のデータ（自社情報は発行時点のもの。下書きは現在の企業設定。ロゴは data URI で同梱） */
estimates.get("/:id/pdf-data", async (ctx) => {
  const auth = ctx.get("auth");
  const est = await loadEstimate(ctx, ctx.req.param("id"));
  const settings = await loadSettings(ctx);
  const issuer = est.issuer ?? issuerFromSettings(settings);
  // 画像は自社のものだけを読み込む（ID が他社のものなら null）
  const image = async (id: string | null | undefined): Promise<string | null> => {
    if (!id) return null;
    const l = await ctx
      .get("db")
      .select({ mime: schema.organizationLogos.mime, data: schema.organizationLogos.data })
      .from(schema.organizationLogos)
      .where(and(eq(schema.organizationLogos.id, id), eq(schema.organizationLogos.organizationId, auth.organizationId)))
      .get();
    return l ? `data:${l.mime};base64,${bytesToBase64(new Uint8Array(l.data as unknown as ArrayBuffer))}` : null;
  };
  const [logo, seal] = await Promise.all([image(issuer.logoId), image(issuer.sealId)]);
  return ctx.json({ estimate: est, issuer, logo, seal });
});

/* ───────────── ホーム（集計） ───────────── */

export const dashboard = new Hono<AppEnv>();

dashboard.get("/", async (ctx) => {
  const { organizationId } = ctx.get("auth");
  const db = ctx.get("db");
  // 日本時間の今月 1日 0:00 〜 来月 1日 0:00 を UTC に直して比較する
  const today = todayJst();
  const month = today.slice(0, 7);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const startUtc = new Date(Date.UTC(y, m - 1, 1) - 9 * 3600_000).toISOString();
  const endUtc = new Date(Date.UTC(y, m, 1) - 9 * 3600_000).toISOString();
  const alive = and(eq(e.organizationId, organizationId), isNull(e.deletedAt));
  const [monthAgg, saved, recent] = await db.batch([
    db
      .select({
        n: count(),
        net: sql<number>`coalesce(sum(${e.subtotalYen} - ${e.discountYen}), 0)`,
        total: sql<number>`coalesce(sum(${e.totalYen}), 0)`,
      })
      .from(e)
      .where(and(alive, gte(e.createdAt, startUtc), sql`${e.createdAt} < ${endUtc}`)),
    db.select({ n: count() }).from(e).where(alive),
    db.select().from(e).where(alive).orderBy(desc(e.createdAt)).limit(6),
  ]);
  return ctx.json({
    month,
    monthCount: monthAgg[0]?.n ?? 0,
    monthSubtotal: monthAgg[0]?.net ?? 0,
    monthTotal: monthAgg[0]?.total ?? 0,
    savedCount: saved[0]?.n ?? 0,
    recent: recent.map(toSummary),
  });
});

