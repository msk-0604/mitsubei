"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { ApiError, api } from "@/lib/api";
import { Alert, Button, Field, TextInput } from "@/components/ui";

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!email.trim() || !password) {
      setError("メールアドレスとパスワードを入力してください");
      return;
    }
    setBusy(true);
    try {
      await api("/auth/sign-in/email", { method: "POST", body: { email: email.trim(), password, rememberMe: true } });
      // 新しいセッションで画面を読み込み直す（前のユーザーのキャッシュを残さない）
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- キャッシュを確実に破棄するため完全に読み直す
      window.location.href = "/";
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 429) setError("ログイン試行回数が多すぎます。15分ほど待ってから再度お試しください");
      else if (err instanceof ApiError && err.status === 0) setError(err.message);
      else setError("メールアドレスまたはパスワードが正しくありません");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {params.get("expired") && !error && <Alert tone="info">ログインの有効期限が切れました。再度ログインしてください。</Alert>}
      {error && <Alert>{error}</Alert>}
      <Field label="メールアドレス" htmlFor="email">
        <TextInput id="email" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field label="パスワード" htmlFor="password">
        <TextInput id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        ログイン
      </Button>
      <p className="text-center text-xs text-slate-500">パスワードを忘れた場合は、社内の管理者に再設定を依頼してください。</p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={56} height={56} className="size-14" />
          <h1 className="text-2xl font-extrabold tracking-wider text-blue-700">MITUBEI</h1>
          <p className="text-sm text-slate-500">見積書作成・価格表管理システム</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
        <p className="mt-6 flex justify-center gap-4 text-xs text-slate-400">
          <Link href="/terms" className="hover:underline">利用規約</Link>
          <Link href="/privacy" className="hover:underline">プライバシーポリシー</Link>
        </p>
      </div>
    </main>
  );
}
