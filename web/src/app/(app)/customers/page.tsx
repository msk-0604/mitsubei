"use client";

import { Plus, Search, Trash2, Users } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { HONORIFICS, type Customer, type Honorific, type Paged } from "../../../../../shared/types";
import { Alert, Button, Card, EmptyState, Field, Modal, PageTitle, Pagination, Select, Spinner, TextArea, TextInput, useConfirm, useToast } from "@/components/ui";
import { ApiError, api, errorMessage, useApi } from "@/lib/api";

type Form = {
  name: string;
  honorific: Honorific;
  contactName: string;
  phone: string;
  email: string;
  postalCode: string;
  address: string;
  notes: string;
};
const empty: Form = { name: "", honorific: "御中", contactName: "", phone: "", email: "", postalCode: "", address: "", notes: "" };

function CustomerModal({ open, customer, onClose, onSaved }: { open: boolean; customer: Customer | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [f, setF] = useState<Form>(() =>
    customer
        ? {
            name: customer.name,
            honorific: customer.honorific,
            contactName: customer.contactName ?? "",
            phone: customer.phone ?? "",
            email: customer.email ?? "",
            postalCode: customer.postalCode ?? "",
            address: customer.address ?? "",
            notes: customer.notes ?? "",
          }
        : empty,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!f.name.trim()) return setErrors({ name: "顧客名・会社名を入力してください" });
    setBusy(true);
    try {
      await api(customer ? `/customers/${customer.id}` : "/customers", { method: customer ? "PATCH" : "POST", body: f, label: "顧客の保存" });
      toast("success", customer ? "更新しました" : "登録しました");
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!customer) return;
    const ok = await confirm({
      title: "顧客を削除しますか？",
      message: `「${customer.name}」を顧客一覧から削除します。作成済みの見積書の宛先はそのまま残ります。`,
      confirmLabel: "削除する",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/customers/${customer.id}`, { method: "DELETE" });
      toast("success", "削除しました");
      onSaved();
      onClose();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={busy}
      title={customer ? "顧客の編集" : "顧客の登録"}
      size="lg"
      footer={
        <>
          {customer && (
            <Button variant="ghost" className="mr-auto text-red-600" onClick={remove}>
              <Trash2 className="size-4" aria-hidden />
              削除
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            キャンセル
          </Button>
          <Button onClick={() => submit()} loading={busy}>
            保存
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <Field label="顧客名・会社名" htmlFor="c-name" required error={errors.name}>
            <div className="flex gap-2">
              <TextInput id="c-name" value={f.name} onChange={(e) => set("name", e.target.value)} error={errors.name} />
              <Select value={f.honorific} onChange={(e) => set("honorific", e.target.value as Honorific)} className="w-24 shrink-0" aria-label="敬称">
                {HONORIFICS.map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </Select>
            </div>
          </Field>
        </div>
        <Field label="担当者名" htmlFor="c-contact" error={errors.contactName}>
          <TextInput id="c-contact" value={f.contactName} onChange={(e) => set("contactName", e.target.value)} />
        </Field>
        <Field label="電話番号" htmlFor="c-phone" error={errors.phone}>
          <TextInput id="c-phone" type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="メールアドレス" htmlFor="c-email" error={errors.email}>
          <TextInput id="c-email" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} error={errors.email} />
        </Field>
        <Field label="郵便番号" htmlFor="c-postal" error={errors.postalCode}>
          <TextInput id="c-postal" value={f.postalCode} onChange={(e) => set("postalCode", e.target.value)} placeholder="123-4567" />
        </Field>
        <Field label="住所" htmlFor="c-address" error={errors.address} className="sm:col-span-2">
          <TextInput id="c-address" value={f.address} onChange={(e) => set("address", e.target.value)} />
        </Field>
        <Field label="メモ" htmlFor="c-notes" className="sm:col-span-2">
          <TextArea id="c-notes" value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className="min-h-16" />
        </Field>
        {customer && <p className="text-xs text-slate-500 sm:col-span-2">変更内容は、発行済みの見積書の宛先には反映されません。</p>}
      </form>
    </Modal>
  );
}

export default function CustomersPage() {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(text.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [text]);
  const { data, error, isLoading, mutate } = useApi<Paged<Customer>>(`/customers?${new URLSearchParams({ q, page: String(page), pageSize: "50" })}`);

  return (
    <div>
      <PageTitle
        title="顧客"
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden />
            顧客を登録
          </Button>
        }
      />
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <TextInput value={text} onChange={(e) => setText(e.target.value)} placeholder="顧客名・担当者・電話番号で検索" className="pl-9" aria-label="顧客を検索" />
      </div>
      {error && <Alert>{error.message}</Alert>}
      <Card>
        {isLoading && !data ? (
          <Spinner />
        ) : data && data.items.length > 0 ? (
          <>
            <ul className="divide-y divide-slate-100">
              {data.items.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-4"
                    onClick={() => {
                      setEditing(c);
                      setOpen(true);
                    }}
                  >
                    <span className="font-medium text-slate-800 sm:w-72 sm:shrink-0 sm:truncate">
                      {c.name} <span className="text-sm font-normal text-slate-500">{c.honorific}</span>
                    </span>
                    <span className="truncate text-sm text-slate-500">{[c.contactName, c.phone, c.address].filter(Boolean).join("　")}</span>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
          </>
        ) : (
          <EmptyState icon={<Users className="size-10" />} title={q ? "該当する顧客はいません" : "顧客はまだ登録されていません"}>
            登録しておくと、見積書の宛先を選ぶだけで入力できます。
          </EmptyState>
        )}
      </Card>
      {open && <CustomerModal open customer={editing} onClose={() => setOpen(false)} onSaved={() => void mutate()} />}
    </div>
  );
}
