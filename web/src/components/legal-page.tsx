import Link from "next/link";
import type { ReactNode } from "react";

/** 利用規約・プライバシーポリシー・特商法表記の共通レイアウト（本文は正式版に差し替える） */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <Link href="/" className="text-sm font-bold tracking-wider text-blue-700">
        MITUBEI
      </Link>
      <h1 className="mt-4 text-2xl font-bold text-slate-800">{title}</h1>
      <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        この文面は仮のものです。公開前に正式な内容へ差し替えてください。
      </p>
      <div className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-6 text-[15px] leading-relaxed text-slate-700 [&_h2]:mt-4 [&_h2]:font-semibold [&_h2]:text-slate-800">
        {children}
      </div>
    </main>
  );
}
