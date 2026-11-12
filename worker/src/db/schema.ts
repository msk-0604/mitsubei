/**
 * MITUBEI データベーススキーマ（Cloudflare D1 / SQLite, Drizzle ORM）
 *
 * マルチテナント方針：
 *  - 企業固有データはすべて organization_id を持つ。
 *  - 子テーブルは (親ID, organization_id) の複合外部キーで親を参照し、
 *    DB レベルでも「別企業の親にぶら下がる行」を作れないようにする。
 *  - API は organization_id を常にセッションから確定し、リクエストの値は使わない。
 *
 * 認証テーブル（users / sessions / accounts / verifications / rate_limits）は Better Auth の形式。
 */
import { sql } from "drizzle-orm";
import { blob, check, foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const createdAt = () => text("created_at").notNull().default(now);
const updatedAt = () => text("updated_at").notNull().default(now);

/* ───────────── 認証（Better Auth） ───────────── */

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

export const verifications = sqliteTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

export const rateLimits = sqliteTable("rate_limits", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});

/** メールアドレス単位のログイン試行回数（IP 単位は Better Auth のレート制限） */
export const loginAttempts = sqliteTable("login_attempts", {
  key: text("key").primaryKey(),
  windowStart: integer("window_start").notNull(),
  count: integer("count").notNull(),
});

/* ───────────── 企業・所属 ───────────── */

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** active / suspended（契約停止時は全員ログイン後の API を拒否） */
  status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const organizationMemberships = sqliteTable(
  "organization_memberships",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** 初期版では 1ユーザー = 1企業（UNIQUE） */
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
    status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("memberships_org_user_uq").on(t.organizationId, t.userId),
    check("memberships_role_ck", sql`${t.role} IN ('admin', 'member')`),
    check("memberships_status_ck", sql`${t.status} IN ('active', 'disabled')`),
  ],
);

export const organizationLogos = sqliteTable(
  "organization_logos",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    mime: text("mime", { enum: ["image/png", "image/jpeg"] }).notNull(),
    data: blob("data", { mode: "buffer" }).notNull(),
    size: integer("size").notNull(),
    width: integer("width"),
    height: integer("height"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("logos_id_org_uq").on(t.id, t.organizationId), index("logos_org_idx").on(t.organizationId)],
);

export const organizationSettings = sqliteTable(
  "organization_settings",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    companyName: text("company_name").notNull(),
    postalCode: text("postal_code"),
    address: text("address"),
    phone: text("phone"),
    email: text("email"),
    bankInfo: text("bank_info"),
    /** 適格請求書発行事業者の登録番号（T + 13桁） */
    registrationNumber: text("registration_number"),
    logoId: text("logo_id"),
    numberPrefix: text("number_prefix").notNull().default("{YYYY}-"),
    numberDigits: integer("number_digits").notNull().default(4),
    numberReset: text("number_reset", { enum: ["yearly", "monthly", "never"] }).notNull().default("yearly"),
    amountRounding: text("amount_rounding", { enum: ["floor", "round", "ceil"] }).notNull().default("floor"),
    taxRounding: text("tax_rounding", { enum: ["floor", "round", "ceil"] }).notNull().default("floor"),
    defaultNotes: text("default_notes"),
    defaultValidDays: integer("default_valid_days").notNull().default(30),
    memberCanEditPrices: integer("member_can_edit_prices", { mode: "boolean" }).notNull().default(false),
    updatedAt: updatedAt(),
    updatedBy: text("updated_by"),
  },
  (t) => [
    foreignKey({
      columns: [t.logoId, t.organizationId],
      foreignColumns: [organizationLogos.id, organizationLogos.organizationId],
      name: "settings_logo_fk",
    }),
  ],
);

/** 見積書番号の連番（企業 × 区切り期間）。UPSERT + RETURNING で原子的に採番する */
export const estimateNumberCounters = sqliteTable(
  "estimate_number_counters",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    lastValue: integer("last_value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.period] })],
);

/* ───────────── 顧客 ───────────── */

export const customers = sqliteTable(
  "customers",
  {
    /** MITUBEI の顧客ID（UUID）。TELKAL とは別の ID 体系 */
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    honorific: text("honorific", { enum: ["御中", "様"] }).notNull().default("御中"),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    postalCode: text("postal_code"),
    address: text("address"),
    notes: text("notes"),
    /** 将来の TELKAL 連携用：TELKAL 側の顧客ID（企業内で一意） */
    telkalCustomerId: text("telkal_customer_id"),
    archivedAt: text("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("customers_id_org_uq").on(t.id, t.organizationId),
    uniqueIndex("customers_org_telkal_uq").on(t.organizationId, t.telkalCustomerId),
    index("customers_org_name_idx").on(t.organizationId, t.archivedAt, t.name),
  ],
);

/* ───────────── 価格表 ───────────── */

export const priceCategories = sqliteTable(
  "price_categories",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("price_categories_id_org_uq").on(t.id, t.organizationId),
    uniqueIndex("price_categories_org_name_uq").on(t.organizationId, t.name),
  ],
);

export const priceItems = sqliteTable(
  "price_items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** 商品コード（企業内で一意。未設定可） */
    code: text("code"),
    name: text("name").notNull(),
    categoryId: text("category_id"),
    spec: text("spec"),
    unit: text("unit"),
    /** 標準単価（1/100円単位の整数） */
    unitPriceX100: integer("unit_price_x100").notNull(),
    taxCategory: text("tax_category", { enum: ["standard", "reduced", "exempt"] }).notNull().default("standard"),
    notes: text("notes"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.categoryId, t.organizationId],
      foreignColumns: [priceCategories.id, priceCategories.organizationId],
      name: "price_items_category_fk",
    }),
    uniqueIndex("price_items_org_code_uq").on(t.organizationId, t.code),
    index("price_items_org_active_name_idx").on(t.organizationId, t.isActive, t.name),
    index("price_items_org_category_idx").on(t.organizationId, t.categoryId),
    index("price_items_org_price_idx").on(t.organizationId, t.unitPriceX100),
    check("price_items_tax_ck", sql`${t.taxCategory} IN ('standard', 'reduced', 'exempt')`),
  ],
);

/* ───────────── 見積書 ───────────── */

export const estimates = sqliteTable(
  "estimates",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    estimateNumber: text("estimate_number").notNull(),
    status: text("status", { enum: ["draft", "issued", "won", "lost"] }).notNull().default("draft"),
    issueDate: text("issue_date").notNull(),
    validUntil: text("valid_until"),
    /** 顧客マスタへの参照（任意）。宛先は下の recipient_* に見積書時点の値を保存する */
    customerId: text("customer_id"),
    recipientName: text("recipient_name").notNull().default(""),
    recipientHonorific: text("recipient_honorific", { enum: ["御中", "様"] }).notNull().default("御中"),
    recipientContact: text("recipient_contact"),
    recipientAddress: text("recipient_address"),
    subject: text("subject").notNull().default(""),
    projectName: text("project_name"),
    projectLocation: text("project_location"),
    notes: text("notes"),
    discountYen: integer("discount_yen").notNull().default(0),
    subtotalYen: integer("subtotal_yen").notNull().default(0),
    taxYen: integer("tax_yen").notNull().default(0),
    totalYen: integer("total_yen").notNull().default(0),
    /** 税率ごとの集計（JSON：TaxGroup[]） */
    taxSummary: text("tax_summary").notNull().default("[]"),
    /** 計算時の端数処理（企業設定を見積書に保存し、設定変更で過去の金額が変わらないようにする） */
    amountRounding: text("amount_rounding", { enum: ["floor", "round", "ceil"] }).notNull(),
    taxRounding: text("tax_rounding", { enum: ["floor", "round", "ceil"] }).notNull(),
    /** 発行時点の自社情報（JSON：IssuerSnapshot）。下書きは null（PDF は現在の企業設定を使う） */
    issuerSnapshot: text("issuer_snapshot"),
    /** 改訂の系列：最初の見積書の ID（改訂版でない場合は null） */
    rootEstimateId: text("root_estimate_id"),
    revisionNumber: integer("revision_number").notNull().default(0),
    revisedFromId: text("revised_from_id"),
    duplicatedFromId: text("duplicated_from_id"),
    issuedAt: text("issued_at"),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    /** 楽観ロック（同時編集で上書きしないため） */
    version: integer("version").notNull().default(1),
    deletedAt: text("deleted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("estimates_id_org_uq").on(t.id, t.organizationId),
    uniqueIndex("estimates_org_number_uq").on(t.organizationId, t.estimateNumber),
    foreignKey({
      columns: [t.customerId, t.organizationId],
      foreignColumns: [customers.id, customers.organizationId],
      name: "estimates_customer_fk",
    }),
    index("estimates_org_issue_idx").on(t.organizationId, t.deletedAt, t.issueDate),
    index("estimates_org_updated_idx").on(t.organizationId, t.deletedAt, t.updatedAt),
    index("estimates_org_created_idx").on(t.organizationId, t.deletedAt, t.createdAt),
    index("estimates_org_status_idx").on(t.organizationId, t.deletedAt, t.status),
    index("estimates_org_root_idx").on(t.organizationId, t.rootEstimateId),
    check("estimates_status_ck", sql`${t.status} IN ('draft', 'issued', 'won', 'lost')`),
    check("estimates_discount_ck", sql`${t.discountYen} >= 0`),
  ],
);

export const estimateItems = sqliteTable(
  "estimate_items",
  {
    id: text("id").primaryKey(),
    estimateId: text("estimate_id").notNull(),
    organizationId: text("organization_id").notNull(),
    position: integer("position").notNull(),
    /** 追加元の価格表の ID（参照のみ。名称・単価は下の列に追加時点の値を保存する） */
    priceItemId: text("price_item_id"),
    name: text("name").notNull(),
    spec: text("spec"),
    quantityMilli: integer("quantity_milli").notNull(),
    unit: text("unit"),
    unitPriceX100: integer("unit_price_x100").notNull(),
    amountYen: integer("amount_yen").notNull(),
    taxCategory: text("tax_category", { enum: ["standard", "reduced", "exempt"] }).notNull(),
    notes: text("notes"),
  },
  (t) => [
    foreignKey({
      columns: [t.estimateId, t.organizationId],
      foreignColumns: [estimates.id, estimates.organizationId],
      name: "estimate_items_estimate_fk",
    }).onDelete("cascade"),
    index("estimate_items_estimate_idx").on(t.estimateId, t.position),
    check("estimate_items_tax_ck", sql`${t.taxCategory} IN ('standard', 'reduced', 'exempt')`),
  ],
);

/** 発行時点の見積書の内容（改ざん・上書き防止のための履歴） */
export const estimateRevisions = sqliteTable(
  "estimate_revisions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    estimateId: text("estimate_id").notNull(),
    revisionNumber: integer("revision_number").notNull(),
    event: text("event", { enum: ["issued", "status_changed"] }).notNull(),
    status: text("status", { enum: ["draft", "issued", "won", "lost"] }).notNull(),
    /** 見積書全体（明細を含む）の JSON */
    snapshot: text("snapshot").notNull(),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.estimateId, t.organizationId],
      foreignColumns: [estimates.id, estimates.organizationId],
      name: "estimate_revisions_estimate_fk",
    }).onDelete("cascade"),
    index("estimate_revisions_estimate_idx").on(t.estimateId, t.createdAt),
  ],
);

/* ───────────── 操作ログ ───────────── */

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    /** 個人情報・金額を含めない補足（件数・ステータスなど） */
    detail: text("detail"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt)],
);
