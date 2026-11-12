import type { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = () => new HttpError(404, "not_found", "見つかりません");
export const forbidden = (message = "この操作を行う権限がありません") => new HttpError(403, "forbidden", message);

/** Zod のエラーを { フィールド名: メッセージ } に変換 */
export function fieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function validationError(error: ZodError): HttpError {
  return new HttpError(400, "validation_error", "入力内容を確認してください", fieldErrors(error));
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

/** LIKE 検索用のエスケープ（ESCAPE '\' と組み合わせる） */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
}

/** 空文字を null に（任意項目の保存用） */
export function nullIfEmpty(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    if (e instanceof Error && /UNIQUE constraint failed/i.test(e.message)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
