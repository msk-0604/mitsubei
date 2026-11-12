"use client";

/**
 * ブラウザから Next.js の API（BFF）を呼ぶためのクライアント。
 * Workers の URL や秘密値はブラウザに渡らない。
 */
import useSWR, { type SWRConfiguration } from "swr";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }

  /** 項目ごとのエラーメッセージ（入力値検証エラー時） */
  get fieldErrors(): Record<string, string> {
    if (this.details && typeof this.details === "object" && !Array.isArray(this.details) && !("rows" in this.details)) {
      return this.details as Record<string, string>;
    }
    return {};
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** 直近の API 応答時間（画面下部に表示する計測用） */
type Listener = (entry: { label: string; ms: number }) => void;
const listeners = new Set<Listener>();
export function onApiTiming(fn: Listener) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export async function api<T>(
  path: string,
  init: { method?: Method; body?: unknown; raw?: BodyInit; contentType?: string; signal?: AbortSignal; label?: string } = {},
): Promise<T> {
  const started = performance.now();
  let res: Response;
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.raw !== undefined && init.contentType) headers["content-type"] = init.contentType;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
      signal: init.signal,
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "network_error", "通信に失敗しました。ネットワーク接続を確認してください");
  }
  const ms = Math.round(performance.now() - started);
  const label = init.label ?? `${init.method ?? "GET"} ${path.split("?")[0]!.replace(/[0-9a-f-]{36}/g, ":id")}`;
  for (const l of listeners) l({ label, ms });

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // 本文なし
  }
  if (!res.ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: unknown }; message?: string; code?: string } | null);
    const e = err?.error;
    if (res.status === 401 && (e?.code === "unauthenticated" || !e)) {
      // セッション切れ：画面状態（他社のデータを含むキャッシュ）を破棄してログイン画面へ
      if (!path.startsWith("/auth/")) window.location.href = "/login?expired=1";
    }
    throw new ApiError(
      res.status,
      e?.code ?? err?.code ?? "http_error",
      e?.message ?? err?.message ?? "エラーが発生しました。時間をおいて再度お試しください",
      e?.details,
    );
  }
  return payload as T;
}

export function useApi<T>(path: string | null, config?: SWRConfiguration<T, ApiError>) {
  return useSWR<T, ApiError>(path, (p: string) => api<T>(p), {
    revalidateOnFocus: false,
    keepPreviousData: true,
    ...config,
  });
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return "エラーが発生しました。時間をおいて再度お試しください";
}
