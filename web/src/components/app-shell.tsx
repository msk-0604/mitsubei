"use client";

import { Building2, FileText, Home, KeyRound, LogOut, Plus, Settings, Tags, Timer, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { SWRConfig } from "swr";
import type { Me } from "../../../shared/types";
import { api, onApiTiming, useApi } from "@/lib/api";
import { Spinner, UiProvider, buttonClass } from "./ui";

const MeContext = createContext<Me | null>(null);

/** ログイン中のユーザー・所属企業・権限（API が判定した値。画面では表示の切り替えにだけ使う） */
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe must be used inside AppShell");
  return me;
}

const NAV = [
  { href: "/", label: "ホーム", icon: Home, match: (p: string) => p === "/" },
  { href: "/estimates", label: "見積書", icon: FileText, match: (p: string) => p.startsWith("/estimates") },
  { href: "/prices", label: "価格表", icon: Tags, match: (p: string) => p.startsWith("/prices") },
  { href: "/customers", label: "顧客", icon: Users, match: (p: string) => p.startsWith("/customers") },
  { href: "/settings", label: "設定", icon: Settings, match: (p: string) => p.startsWith("/settings") },
];

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-blue-600" aria-label="MITUBEI ホーム">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.svg" alt="" width={32} height={32} className="size-8" />
      <span className="flex flex-col leading-none">
        <span className="text-lg font-extrabold tracking-wider text-blue-700">MITUBEI</span>
        <span className="hidden text-[10px] font-medium text-slate-500 sm:block">見積書作成・価格表管理</span>
      </span>
    </Link>
  );
}

async function logout() {
  try {
    await api("/auth/sign-out", { method: "POST", body: {} });
  } finally {
    // 画面のキャッシュ（企業のデータ）をすべて破棄するため、ページごと読み直す
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- キャッシュを確実に破棄するため完全に読み直す
    window.location.href = "/login";
  }
}

function ApiTimingIndicator() {
  const [last, setLast] = useState<{ label: string; ms: number } | null>(null);
  useEffect(() => onApiTiming(setLast), []);
  if (!last) return null;
  return (
    <p className="flex items-center justify-center gap-1 text-[11px] text-slate-400" aria-live="off">
      <Timer className="size-3" aria-hidden />
      {last.label}：<span className={last.ms > 500 ? "font-semibold text-amber-600" : ""}>{last.ms}ms</span>
    </p>
  );
}

function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur print:hidden">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Logo />
            <nav className="hidden items-center gap-1 md:flex" aria-label="メインメニュー">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`rounded-lg px-3 py-2 text-sm font-medium ${
                    n.match(pathname) ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <span className="hidden max-w-52 items-center gap-1.5 truncate text-sm text-slate-600 lg:inline-flex" title={`${me.organization.name} / ${me.user.name}`}>
              <Building2 className="size-4 shrink-0 text-slate-400" aria-hidden />
              <span className="truncate">{me.organization.name}</span>
            </span>
            <Link href="/settings/account" className="hidden h-10 items-center rounded-lg px-2.5 text-slate-600 hover:bg-slate-100 sm:inline-flex" title="パスワード変更" aria-label="パスワード変更">
              <KeyRound className="size-4" />
            </Link>
            <button type="button" onClick={logout} className="inline-flex h-10 items-center gap-1 rounded-lg px-2.5 text-sm text-slate-600 hover:bg-slate-100" title="ログアウト" aria-label="ログアウト">
              <LogOut className="size-4" />
              <span className="hidden xl:inline">ログアウト</span>
            </button>
            <Link href="/estimates/new" className={buttonClass("primary", "md", "px-3 sm:px-4")}>
              <Plus className="size-4" aria-hidden />
              <span className="hidden sm:inline">新しい見積書を作成</span>
              <span className="sm:hidden">新規</span>
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-5 sm:px-6 sm:pt-7 md:pb-10">{children}</main>
      <footer className="hidden px-4 pb-6 md:block print:hidden">
        <ApiTimingIndicator />
        <p className="mt-2 flex justify-center gap-4 text-xs text-slate-400">
          <Link href="/terms" className="hover:underline">利用規約</Link>
          <Link href="/privacy" className="hover:underline">プライバシーポリシー</Link>
          <Link href="/legal" className="hover:underline">特定商取引法に基づく表記</Link>
          <span>© Stark Lab</span>
        </p>
      </footer>
      {/* スマートフォン用の下部ナビ */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
        aria-label="メインメニュー"
      >
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${n.match(pathname) ? "text-blue-600" : "text-slate-500"}`}
          >
            <n.icon className="size-5" aria-hidden />
            {n.label}
          </Link>
        ))}
      </nav>
    </>
  );
}

function MeLoader({ children }: { children: ReactNode }) {
  const { data: me, error } = useApi<Me>("/me");
  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-slate-700">{error.message}</p>
        <button type="button" className={buttonClass("secondary")} onClick={logout}>
          ログイン画面へ
        </button>
      </div>
    );
  }
  if (!me) return <Spinner />;
  return (
    <MeContext.Provider value={me}>
      <Shell me={me}>{children}</Shell>
    </MeContext.Provider>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ revalidateOnFocus: false, shouldRetryOnError: false }}>
      <UiProvider>
        <MeLoader>{children}</MeLoader>
      </UiProvider>
    </SWRConfig>
  );
}
