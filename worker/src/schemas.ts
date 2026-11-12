/** 入力値検証（Zod）。API に届いた値はすべてここで検証してから使う */
import { z } from "zod";
import {
  MAX_ITEMS,
  MAX_QUANTITY_MILLI,
  MAX_UNIT_PRICE_X100,
  PRICE_SCALE,
  QUANTITY_SCALE,
  ROUNDING_MODES,
  TAX_CATEGORIES,
  parseDecimal,
} from "../../shared/calc";

const optText = (max: number, label: string) =>
  z
    .string({ error: `${label}の形式が正しくありません` })
    .trim()
    .max(max, { error: `${label}は${max}文字以内で入力してください` })
    .nullish()
    .transform((v) => (v ? v : null));

const reqText = (max: number, label: string) =>
  z
    .string({ error: `${label}を入力してください` })
    .trim()
    .min(1, { error: `${label}を入力してください` })
    .max(max, { error: `${label}は${max}文字以内で入力してください` });

const draftText = (max: number, label: string) =>
  z
    .string({ error: `${label}の形式が正しくありません` })
    .trim()
    .max(max, { error: `${label}は${max}文字以内で入力してください` })
    .default("");

export const idSchema = z.uuid({ error: "ID の形式が正しくありません" });
const optId = idSchema.nullish().transform((v) => v ?? null);

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "日付の形式が正しくありません" })
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), {
    error: "存在しない日付です",
  });

const decimal = (scale: number, max: bigint, label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v, ctx) => {
      const parsed = parseDecimal(String(v), scale);
      if (parsed === null) {
        ctx.addIssue({ code: "custom", message: `${label}は数値で入力してください（小数${scale}桁まで）` });
        return z.NEVER;
      }
      if (parsed > max || parsed < -max) {
        ctx.addIssue({ code: "custom", message: `${label}が大きすぎます` });
        return z.NEVER;
      }
      return parsed;
    });

export const quantityField = decimal(QUANTITY_SCALE, MAX_QUANTITY_MILLI, "数量");
export const unitPriceField = decimal(PRICE_SCALE, MAX_UNIT_PRICE_X100, "単価");
export const taxCategoryField = z.enum(TAX_CATEGORIES, { error: "税区分を選択してください" });
const roundingField = z.enum(ROUNDING_MODES, { error: "端数処理を選択してください" });
const honorificField = z.enum(["御中", "様"], { error: "敬称を選択してください" });

const email = z
  .string()
  .trim()
  .max(254, { error: "メールアドレスが長すぎます" })
  .pipe(z.email({ error: "メールアドレスの形式が正しくありません" }));
const optEmail = z
  .string()
  .trim()
  .max(254)
  .nullish()
  .transform((v) => (v ? v : null))
  .pipe(z.email({ error: "メールアドレスの形式が正しくありません" }).nullable());

/* ───── 顧客 ───── */
export const customerInput = z.object({
  name: reqText(200, "顧客名・会社名"),
  honorific: honorificField.default("御中"),
  contactName: optText(100, "担当者名"),
  phone: optText(30, "電話番号"),
  email: optEmail,
  postalCode: optText(10, "郵便番号"),
  address: optText(300, "住所"),
  notes: optText(2000, "備考"),
  telkalCustomerId: optText(64, "TELKAL 顧客ID"),
});

/* ───── 価格表 ───── */
export const priceCategoryInput = z.object({
  name: reqText(50, "カテゴリ名"),
  sortOrder: z.number().int().min(0).max(100000).default(0),
});

export const priceItemInput = z.object({
  code: optText(50, "商品コード"),
  name: reqText(200, "商品名・工事項目名"),
  categoryId: optId,
  spec: optText(200, "規格・仕様"),
  unit: optText(20, "単位"),
  unitPrice: unitPriceField,
  taxCategory: taxCategoryField.default("standard"),
  notes: optText(1000, "備考"),
  isActive: z.boolean().default(true),
});

/** CSV 一括登録（画面で列の対応付け・文字コード変換を済ませた行） */
export const priceImportInput = z.object({
  /** 商品コードが既存と重複した場合：上書き / スキップ */
  onDuplicate: z.enum(["overwrite", "skip"]),
  rows: z
    .array(
      z.object({
        code: z.string().nullish(),
        name: z.string().nullish(),
        category: z.string().nullish(),
        spec: z.string().nullish(),
        unit: z.string().nullish(),
        unitPrice: z.string().nullish(),
        taxCategory: z.string().nullish(),
        notes: z.string().nullish(),
      }),
    )
    .min(1, { error: "取り込む行がありません" })
    .max(2000, { error: "一度に取り込めるのは2,000行までです" }),
});

/* ───── 見積書 ───── */
export const estimateItemInput = z.object({
  priceItemId: optId,
  name: reqText(200, "品名・工事項目"),
  spec: optText(200, "規格・仕様"),
  quantity: quantityField,
  unit: optText(20, "単位"),
  unitPrice: unitPriceField,
  taxCategory: taxCategoryField,
  notes: optText(500, "備考"),
});

export const estimateInput = z.object({
  /** 空なら自動採番 */
  estimateNumber: optText(40, "見積書番号").refine((v) => v === null || /^[^\s<>]+$/.test(v), {
    error: "見積書番号に空白や記号 < > は使えません",
  }),
  issueDate: ymd,
  validUntil: ymd.nullish().transform((v) => v ?? null),
  customerId: optId,
  recipientName: draftText(200, "宛先"),
  recipientHonorific: honorificField.default("御中"),
  recipientContact: optText(100, "担当者名"),
  recipientAddress: optText(300, "宛先住所"),
  subject: draftText(200, "件名"),
  projectName: optText(200, "工事名・案件名"),
  projectLocation: optText(300, "工事場所"),
  notes: optText(3000, "備考"),
  discount: z
    .number({ error: "値引きは数値で入力してください" })
    .int({ error: "値引きは円単位の整数で入力してください" })
    .min(0, { error: "値引きは0円以上で入力してください" })
    .max(999_999_999_999, { error: "値引きが大きすぎます" })
    .default(0),
  items: z.array(estimateItemInput).max(MAX_ITEMS, { error: `明細は${MAX_ITEMS}行までです` }).default([]),
});

export const estimateUpdateInput = estimateInput.extend({
  version: z.number().int().min(1),
});

export const statusInput = z.object({
  status: z.enum(["issued", "won", "lost"], { error: "ステータスを選択してください" }),
});

export const versionInput = z.object({ version: z.number().int().min(1) });

/* ───── 企業設定 ───── */
export const settingsInput = z.object({
  companyName: reqText(200, "会社名"),
  postalCode: optText(10, "郵便番号"),
  address: optText(300, "住所"),
  phone: optText(30, "電話番号"),
  email: optEmail,
  bankInfo: optText(500, "振込先"),
  registrationNumber: optText(14, "登録番号").refine((v) => v === null || /^T\d{13}$/.test(v), {
    error: "登録番号は T + 13桁の数字で入力してください",
  }),
  numberPrefix: z
    .string()
    .trim()
    .max(20, { error: "接頭辞は20文字以内で入力してください" })
    .regex(/^[^\s<>]*$/, { error: "接頭辞に空白や記号 < > は使えません" }),
  numberDigits: z.number().int().min(1).max(8),
  numberReset: z.enum(["yearly", "monthly", "never"]),
  amountRounding: roundingField,
  taxRounding: roundingField,
  defaultNotes: optText(3000, "備考の初期値"),
  defaultValidDays: z.number().int().min(1, { error: "有効期限は1日以上にしてください" }).max(365),
  memberCanEditPrices: z.boolean(),
  /** 承認欄の見出し（最大4つ、各6文字まで。空なら表示しない） */
  stampBoxes: z
    .array(z.string().trim().min(1).max(6, { error: "承認欄の見出しは6文字以内にしてください" }))
    .max(4, { error: "承認欄は4つまでです" })
    .default([]),
});

/* ───── 社員 ───── */
export const memberCreateInput = z.object({
  name: reqText(100, "氏名"),
  email,
  password: z.string().min(10, { error: "パスワードは10文字以上にしてください" }).max(128),
  role: z.enum(["admin", "member"]),
});

export const memberUpdateInput = z.object({
  name: reqText(100, "氏名").optional(),
  role: z.enum(["admin", "member"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

export const memberPasswordInput = z.object({
  password: z.string().min(10, { error: "パスワードは10文字以上にしてください" }).max(128),
});

/* ───── 一覧の検索条件 ───── */
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
