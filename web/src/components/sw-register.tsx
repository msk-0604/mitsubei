"use client";

import { useEffect } from "react";

/** 本番環境でのみ Service Worker を登録する（ホーム画面に追加して使うため） */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
