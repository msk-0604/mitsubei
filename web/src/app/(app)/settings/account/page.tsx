"use client";

import { useState, type FormEvent } from "react";
import { useMe } from "@/components/app-shell";
import { Alert, Button, Card, CardHeader, Field, PageTitle, TextInput, useToast } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

export default function AccountPage() {
  const me = useMe();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 10) return setError("新しいパスワードは10文字以上にしてください");
    if (next !== confirm) return setError("確認用のパスワードが一致しません");
    setBusy(true);
    try {
      await api("/auth/change-password", { method: "POST", body: { currentPassword: current, newPassword: next, revokeOtherSessions: true } });
      toast("success", "パスワードを変更しました（ほかの端末はログアウトされました）");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      const msg = errorMessage(err);
      setError(/password/i.test(msg) ? "現在のパスワードが正しくありません" : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageTitle title="パスワード変更" />
      <Card>
        <CardHeader title={me.user.name} description={me.user.email} />
        <form onSubmit={submit} className="space-y-4 p-5" noValidate>
          {error && <Alert>{error}</Alert>}
          <Field label="現在のパスワード" htmlFor="cur">
            <TextInput id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="新しいパスワード" htmlFor="new" hint="10文字以上。ほかのサービスと同じパスワードは避けてください">
            <TextInput id="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="新しいパスワード（確認）" htmlFor="new2">
            <TextInput id="new2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <Button type="submit" loading={busy} className="w-full">
            変更する
          </Button>
        </form>
      </Card>
    </div>
  );
}
