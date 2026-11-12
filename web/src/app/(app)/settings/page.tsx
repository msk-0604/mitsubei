"use client";

import { ImageUp, KeyRound, ScrollText, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ROUNDING_LABELS, ROUNDING_MODES, type RoundingMode } from "../../../../../shared/calc";
import { NUMBER_RESET_LABELS, formatEstimateNumber, todayJst, type NumberReset } from "../../../../../shared/numbering";
import type { OrganizationSettings } from "../../../../../shared/types";
import { useMe } from "@/components/app-shell";
import { Alert, Button, Card, CardHeader, Field, PageTitle, Select, Spinner, TextArea, TextInput, useConfirm, useToast } from "@/components/ui";
import { ApiError, api, errorMessage, useApi } from "@/lib/api";

const MAX_LOGO = 300 * 1024;

function LogoSection({ logoId, onChanged, disabled }: { logoId: string | null; onChanged: () => void; disabled: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) return toast("error", "PNG または JPEG の画像を選んでください");
    if (file.size > MAX_LOGO) return toast("error", "ロゴ画像は300KB以下にしてください");
    setBusy(true);
    try {
      await api("/settings/logo", { method: "POST", raw: file, contentType: file.type, label: "ロゴのアップロード" });
      toast("success", "ロゴを登録しました");
      onChanged();
    } catch (e) {
      toast("error", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!(await confirm({ title: "ロゴを外しますか？", message: "これから作成・発行する見積書にロゴが表示されなくなります。発行済みの見積書は変わりません。", confirmLabel: "外す", danger: true }))) return;
    try {
      await api("/settings/logo", { method: "DELETE" });
      onChanged();
    } catch (e) {
      toast("error", errorMessage(e));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex h-20 w-48 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {logoId ? <img src={`/api/logos/${logoId}`} alt="会社ロゴ" className="max-h-16 max-w-44 object-contain" /> : <span className="text-xs text-slate-400">ロゴ未登録</span>}
      </div>
      {!disabled && (
        <div className="flex flex-col gap-2">
          <label className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 ${busy ? "opacity-60" : ""}`}>
            <ImageUp className="size-4" aria-hidden />
            {busy ? "アップロード中…" : "画像を選択"}
            <input type="file" accept="image/png,image/jpeg" className="sr-only" disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
          </label>
          {logoId && (
            <Button variant="ghost" size="sm" className="text-red-600" onClick={remove}>
              <Trash2 className="size-4" aria-hidden />
              ロゴを外す
            </Button>
          )}
          <p className="text-xs text-slate-500">PNG / JPEG、300KB以下</p>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const me = useMe();
  const toast = useToast();
  const isAdmin = me.permissions.manageSettings;
  const { data, error, mutate } = useApi<OrganizationSettings>("/settings");
  const [f, setF] = useState<OrganizationSettings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // 取得した設定（保存後・ロゴ変更後を含む）をフォームに反映する
  const [loaded, setLoaded] = useState<OrganizationSettings | undefined>(undefined);
  if (data && data !== loaded) {
    setLoaded(data);
    setF((cur) => (cur && loaded ? { ...cur, logoId: data.logoId, updatedAt: data.updatedAt } : data));
  }

  if (error) return <Alert>{error.message}</Alert>;
  if (!f) return <Spinner />;
  const set = <K extends keyof OrganizationSettings>(k: K, v: OrganizationSettings[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const preview = formatEstimateNumber(f.numberPrefix, f.numberDigits, 1, todayJst());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f) return;
    setBusy(true);
    setErrors({});
    try {
      const saved = await api<OrganizationSettings>("/settings", { method: "PUT", body: f, label: "企業設定の保存" });
      await mutate(saved, { revalidate: false });
      toast("success", "保存しました");
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const text = (k: keyof OrganizationSettings, label: string, props: { required?: boolean; placeholder?: string; type?: string; className?: string; hint?: string } = {}) => (
    <Field label={label} htmlFor={`s-${k}`} required={props.required} error={errors[k]} className={props.className} hint={props.hint}>
      <TextInput
        id={`s-${k}`}
        type={props.type}
        value={(f[k] as string | null) ?? ""}
        onChange={(e) => set(k, e.target.value as never)}
        disabled={!isAdmin}
        placeholder={props.placeholder}
        error={errors[k]}
      />
    </Field>
  );

  return (
    <div className="space-y-4">
      <PageTitle title="設定" />
      <div className="grid gap-3 sm:grid-cols-3">
        {me.permissions.manageMembers && (
          <Link href="/settings/members" className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-300">
            <Users className="size-5 text-blue-600" aria-hidden />
            <span className="font-medium">社員・権限の管理</span>
          </Link>
        )}
        <Link href="/settings/account" className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-300">
          <KeyRound className="size-5 text-blue-600" aria-hidden />
          <span className="font-medium">パスワード変更</span>
        </Link>
        {me.role === "admin" && (
          <Link href="/settings/audit" className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-300">
            <ScrollText className="size-5 text-blue-600" aria-hidden />
            <span className="font-medium">操作ログ</span>
          </Link>
        )}
      </div>

      {!isAdmin && <Alert tone="info">企業設定は管理者のみ変更できます。</Alert>}

      <form onSubmit={submit} className="space-y-4" noValidate>
        <Card>
          <CardHeader title="自社情報" description="見積書（PDF）に表示されます" />
          <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
            {text("companyName", "会社名", { required: true, className: "sm:col-span-2" })}
            {text("postalCode", "郵便番号", { placeholder: "123-4567" })}
            {text("phone", "電話番号")}
            {text("address", "住所", { className: "sm:col-span-2" })}
            {text("email", "メールアドレス", { type: "email" })}
            {text("registrationNumber", "登録番号（適格請求書発行事業者）", { placeholder: "T1234567890123", hint: "T + 13桁。登録している場合のみ" })}
            <Field label="振込先" htmlFor="s-bank" className="sm:col-span-2" error={errors.bankInfo}>
              <TextArea id="s-bank" value={f.bankInfo ?? ""} onChange={(e) => set("bankInfo", e.target.value)} disabled={!isAdmin} rows={2} className="min-h-16" placeholder="〇〇銀行 〇〇支店 普通 1234567 カ）〇〇" />
            </Field>
            <div className="sm:col-span-2">
              <p className="mb-1.5 text-sm font-medium text-slate-700">会社ロゴ</p>
              <LogoSection logoId={f.logoId} disabled={!isAdmin} onChanged={() => void mutate()} />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="見積書の設定" />
          <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
            <Field label="番号の接頭辞" htmlFor="s-prefix" error={errors.numberPrefix} hint="{YYYY}=年4桁 {YY}=年2桁 {MM}=月">
              <TextInput id="s-prefix" value={f.numberPrefix} onChange={(e) => set("numberPrefix", e.target.value)} disabled={!isAdmin} />
            </Field>
            <Field label="連番の桁数" htmlFor="s-digits">
              <Select id="s-digits" value={f.numberDigits} onChange={(e) => set("numberDigits", Number(e.target.value))} disabled={!isAdmin}>
                {[3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}桁
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="連番のリセット" htmlFor="s-reset" hint={`次の番号の例：${preview}`}>
              <Select id="s-reset" value={f.numberReset} onChange={(e) => set("numberReset", e.target.value as NumberReset)} disabled={!isAdmin}>
                {(Object.keys(NUMBER_RESET_LABELS) as NumberReset[]).map((k) => (
                  <option key={k} value={k}>
                    {NUMBER_RESET_LABELS[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="明細金額の端数処理" htmlFor="s-amount" hint="数量×単価の1円未満">
              <Select id="s-amount" value={f.amountRounding} onChange={(e) => set("amountRounding", e.target.value as RoundingMode)} disabled={!isAdmin}>
                {ROUNDING_MODES.map((m) => (
                  <option key={m} value={m}>
                    {ROUNDING_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="消費税の端数処理" htmlFor="s-tax" hint="税率ごとの合計に対して1回">
              <Select id="s-tax" value={f.taxRounding} onChange={(e) => set("taxRounding", e.target.value as RoundingMode)} disabled={!isAdmin}>
                {ROUNDING_MODES.map((m) => (
                  <option key={m} value={m}>
                    {ROUNDING_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="有効期限（発行日から）" htmlFor="s-valid" error={errors.defaultValidDays}>
              <div className="flex items-center gap-2">
                <TextInput id="s-valid" type="number" min={1} max={365} value={f.defaultValidDays} onChange={(e) => set("defaultValidDays", Number(e.target.value))} disabled={!isAdmin} className="w-24" />
                <span className="text-sm text-slate-600">日</span>
              </div>
            </Field>
            <Field label="備考の初期値" htmlFor="s-notes" className="sm:col-span-2 lg:col-span-3" error={errors.defaultNotes}>
              <TextArea id="s-notes" value={f.defaultNotes ?? ""} onChange={(e) => set("defaultNotes", e.target.value)} disabled={!isAdmin} rows={3} />
            </Field>
            <Field label="一般社員の価格表編集" htmlFor="s-member-price" className="sm:col-span-2">
              <Select id="s-member-price" value={f.memberCanEditPrices ? "1" : "0"} onChange={(e) => set("memberCanEditPrices", e.target.value === "1")} disabled={!isAdmin}>
                <option value="0">管理者のみ編集できる（一般社員は閲覧のみ）</option>
                <option value="1">一般社員も編集できる</option>
              </Select>
            </Field>
            <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-3">
              端数処理を変更しても、発行済みの見積書の金額は変わりません。下書きは次に保存したときに新しい設定で計算されます。
            </p>
          </div>
        </Card>

        {isAdmin && (
          <div className="flex justify-end">
            <Button type="submit" size="lg" loading={busy}>
              設定を保存
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
