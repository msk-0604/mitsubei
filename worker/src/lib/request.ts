import type { z } from "zod";
import type { AppContext } from "./context";
import { HttpError, validationError } from "./http";

const MAX_JSON_BYTES = 1024 * 1024;

/** JSON 本文を読み、Zod で検証する */
export async function parseBody<S extends z.ZodType>(c: AppContext, schema: S): Promise<z.output<S>> {
  const len = Number(c.req.header("content-length") ?? "0");
  if (len > MAX_JSON_BYTES) throw new HttpError(413, "payload_too_large", "送信データが大きすぎます");
  const ct = c.req.header("content-type") ?? "";
  if (!ct.includes("application/json")) throw new HttpError(415, "unsupported_media_type", "リクエストの形式が正しくありません");
  let raw: unknown;
  try {
    const text = await c.req.text();
    if (text.length > MAX_JSON_BYTES) throw new HttpError(413, "payload_too_large", "送信データが大きすぎます");
    raw = JSON.parse(text);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "invalid_json", "リクエストの形式が正しくありません");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
}

export function parseQuery<S extends z.ZodType>(c: AppContext, schema: S): z.output<S> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
}
