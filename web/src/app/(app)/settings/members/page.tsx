"use client";

import { KeyRound, UserPlus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ROLE_LABELS, type Member, type Role } from "../../../../../../shared/types";
import { useMe } from "@/components/app-shell";
import { Alert, Badge, Button, Card, Field, Modal, PageTitle, Select, Spinner, TextInput, useConfirm, useToast } from "@/components/ui";
import { ApiError, api, errorMessage, useApi } from "@/lib/api";
import { formatYmd } from "@/lib/format";

export default function MembersPage() {
  const me = useMe();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, mutate } = useApi<{ items: Member[] }>(me.permissions.manageMembers ? "/members" : null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "member" as Role });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pwTarget, setPwTarget] = useState<Member | null>(null);
  const [pw, setPw] = useState("");

  if (!me.permissions.manageMembers) return <Alert>この画面は管理者のみ利用できます。</Alert>;

  async function add(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const r = await api<{ items: Member[] }>("/members", { method: "POST", body: form });
      await mutate(r, { revalidate: false });
      toast("success", "社員を追加しました。メールアドレスと初期パスワードを本人に伝えてください");
      setAddOpen(false);
      setForm({ name: "", email: "", password: "", role: "member" });
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function update(m: Member, patch: Partial<Pick<Member, "role" | "status">>) {
    if (patch.status === "disabled") {
      const ok = await confirm({ title: "利用を停止しますか？", message: `${m.name} さんはログインできなくなり、ログイン中の端末もログアウトされます。`, confirmLabel: "停止する", danger: true });
      if (!ok) return;
    }
    try {
      const r = await api<{ items: Member[] }>(`/members/${m.id}`, { method: "PATCH", body: patch });
      await mutate(r, { revalidate: false });
      toast("success", "変更しました");
    } catch (err) {
      toast("error", errorMessage(err));
    }
  }

  async function resetPassword(e?: FormEvent) {
    e?.preventDefault();
    if (!pwTarget) return;
    if (pw.length < 10) return toast("error", "パスワードは10文字以上にしてください");
    try {
      await api(`/members/${pwTarget.id}/password`, { method: "POST", body: { password: pw } });
      toast("success", "パスワードを再設定しました");
      setPwTarget(null);
      setPw("");
    } catch (err) {
      toast("error", errorMessage(err));
    }
  }

  return (
    <div>
      <PageTitle
        title="社員・権限の管理"
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <UserPlus className="size-4" aria-hidden />
            社員を追加
          </Button>
        }
      />
      <div className="mb-4 text-sm text-slate-600">
        <p>管理者：企業設定・社員管理・価格表の編集・すべての見積書の削除ができます。</p>
        <p>一般社員：見積書の作成・編集・発行、顧客の登録ができます（価格表の編集は企業設定で許可した場合のみ）。</p>
      </div>
      {error && <Alert>{error.message}</Alert>}
      <Card>
        {!data ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.items.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {m.name} {m.userId === me.user.id && <span className="text-xs text-blue-700">（あなた）</span>}{" "}
                    {m.status === "disabled" && <Badge tone="red">停止中</Badge>}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {m.email}　登録 {formatYmd(m.createdAt.slice(0, 10))}
                  </p>
                </div>
                <Select
                  value={m.role}
                  onChange={(e) => update(m, { role: e.target.value as Role })}
                  disabled={m.userId === me.user.id}
                  className="h-9 w-28 text-sm"
                  aria-label={`${m.name}の権限`}
                >
                  {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
                {m.userId !== me.user.id && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setPwTarget(m)}>
                      <KeyRound className="size-4" aria-hidden />
                      パスワード再設定
                    </Button>
                    {m.status === "active" ? (
                      <Button variant="ghost" size="sm" className="text-red-600" onClick={() => update(m, { status: "disabled" })}>
                        利用停止
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => update(m, { status: "active" })}>
                        利用再開
                      </Button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="社員を追加"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)}>
              キャンセル
            </Button>
            <Button onClick={() => add()} loading={busy}>
              追加
            </Button>
          </>
        }
      >
        <form onSubmit={add} className="space-y-4" noValidate>
          <Field label="氏名" htmlFor="m-name" required error={errors.name}>
            <TextInput id="m-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
          </Field>
          <Field label="メールアドレス（ログインID）" htmlFor="m-email" required error={errors.email}>
            <TextInput id="m-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} />
          </Field>
          <Field label="初期パスワード" htmlFor="m-pw" required error={errors.password} hint="10文字以上。ログイン後に本人が変更できます">
            <TextInput id="m-pw" type="text" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} error={errors.password} />
          </Field>
          <Field label="権限" htmlFor="m-role">
            <Select id="m-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="member">一般社員</option>
              <option value="admin">管理者</option>
            </Select>
          </Field>
        </form>
      </Modal>

      <Modal
        open={!!pwTarget}
        onClose={() => setPwTarget(null)}
        title={`${pwTarget?.name ?? ""} さんのパスワード再設定`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPwTarget(null)}>
              キャンセル
            </Button>
            <Button onClick={() => resetPassword()}>再設定</Button>
          </>
        }
      >
        <form onSubmit={resetPassword} className="space-y-2">
          <Field label="新しいパスワード" htmlFor="m-newpw" hint="10文字以上。再設定するとその社員はすべての端末でログアウトされます">
            <TextInput id="m-newpw" type="text" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
