/** API の入出力の型（画面・API 共通） */
import type { RoundingMode, TaxCategory, TaxGroup } from "./calc";
import type { NumberReset } from "./numbering";

export type Role = "admin" | "member";
export const ROLE_LABELS: Record<Role, string> = { admin: "管理者", member: "一般社員" };

export type EstimateStatus = "draft" | "issued" | "won" | "lost";
export const ESTIMATE_STATUSES: EstimateStatus[] = ["draft", "issued", "won", "lost"];
export const STATUS_LABELS: Record<EstimateStatus, string> = {
  draft: "下書き",
  issued: "発行済み",
  won: "受注",
  lost: "失注",
};

export type Honorific = "御中" | "様";
export const HONORIFICS: Honorific[] = ["御中", "様"];

export type Me = {
  user: { id: string; name: string; email: string };
  organization: { id: string; name: string };
  role: Role;
  permissions: { editPrices: boolean; manageSettings: boolean; manageMembers: boolean };
};

export type Customer = {
  id: string;
  name: string;
  honorific: Honorific;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  postalCode: string | null;
  address: string | null;
  notes: string | null;
  /** 将来の TELKAL 連携用（TELKAL 側の顧客ID） */
  telkalCustomerId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PriceCategory = { id: string; name: string; sortOrder: number; itemCount?: number };

export type PriceItem = {
  id: string;
  code: string | null;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  spec: string | null;
  unit: string | null;
  /** 標準単価（10進数の文字列。小数2桁まで） */
  unitPrice: string;
  taxCategory: TaxCategory;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type EstimateItem = {
  id?: string;
  priceItemId: string | null;
  name: string;
  spec: string | null;
  /** 10進数の文字列（小数3桁まで） */
  quantity: string;
  unit: string | null;
  /** 10進数の文字列（小数2桁まで） */
  unitPrice: string;
  amount: number;
  taxCategory: TaxCategory;
  notes: string | null;
};

export type IssuerSnapshot = {
  companyName: string;
  postalCode: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  registrationNumber: string | null;
  bankInfo: string | null;
  logoId: string | null;
};

export type EstimateSummary = {
  id: string;
  estimateNumber: string;
  status: EstimateStatus;
  issueDate: string;
  validUntil: string | null;
  recipientName: string;
  recipientHonorific: Honorific;
  subject: string;
  /** 税抜合計（値引き後） */
  subtotal: number;
  tax: number;
  /** 税込合計 */
  total: number;
  revisionNumber: number;
  createdAt: string;
  updatedAt: string;
};

export type Estimate = EstimateSummary & {
  customerId: string | null;
  recipientContact: string | null;
  recipientAddress: string | null;
  projectName: string | null;
  projectLocation: string | null;
  notes: string | null;
  /** 明細合計（税抜・値引き前） */
  itemsSubtotal: number;
  discount: number;
  taxGroups: TaxGroup[];
  amountRounding: RoundingMode;
  taxRounding: RoundingMode;
  issuer: IssuerSnapshot | null;
  rootEstimateId: string | null;
  revisedFromId: string | null;
  issuedAt: string | null;
  version: number;
  createdByName: string | null;
  items: EstimateItem[];
  /** 同じ見積書の改訂の系列（元の見積書と改訂版） */
  revisions: Array<{ id: string; estimateNumber: string; revisionNumber: number; status: EstimateStatus; updatedAt: string }>;
};

export type OrganizationSettings = {
  companyName: string;
  postalCode: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  bankInfo: string | null;
  registrationNumber: string | null;
  logoId: string | null;
  numberPrefix: string;
  numberDigits: number;
  numberReset: NumberReset;
  amountRounding: RoundingMode;
  taxRounding: RoundingMode;
  defaultNotes: string | null;
  defaultValidDays: number;
  memberCanEditPrices: boolean;
  updatedAt: string;
};

export type Member = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  status: "active" | "disabled";
  createdAt: string;
};

export type Dashboard = {
  month: string;
  monthCount: number;
  monthSubtotal: number;
  monthTotal: number;
  savedCount: number;
  recent: EstimateSummary[];
};

export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };
