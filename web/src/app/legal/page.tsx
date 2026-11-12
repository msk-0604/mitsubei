import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "特定商取引法に基づく表記" };

const rows = [
  ["販売事業者", "株式会社Stark Lab"],
  ["運営責任者", "（後で記載）"],
  ["所在地", "（後で記載）"],
  ["電話番号", "（後で記載）"],
  ["メールアドレス", "（後で記載）"],
  ["販売価格", "（後で記載）"],
  ["支払方法・時期", "（後で記載）"],
  ["提供時期", "（後で記載）"],
  ["解約について", "（後で記載）"],
];

export default function LegalNoticePage() {
  return (
    <LegalPage title="特定商取引法に基づく表記">
      <dl className="divide-y divide-slate-100">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-1 py-2 sm:grid-cols-[10rem_1fr]">
            <dt className="font-medium text-slate-600">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </LegalPage>
  );
}
