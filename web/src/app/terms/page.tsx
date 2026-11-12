import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "利用規約" };

export default function TermsPage() {
  return (
    <LegalPage title="利用規約">
      <p>本規約は、株式会社Stark Lab（以下「当社」）が提供する見積書作成・価格表管理サービス「MITUBEI」（以下「本サービス」）の利用条件を定めるものです。</p>
      <h2>第1条（適用）</h2>
      <p>（本文は後で差し替えます）</p>
      <h2>第2条（利用契約）</h2>
      <p>（本文は後で差し替えます）</p>
      <h2>第3条（料金および支払方法）</h2>
      <p>（本文は後で差し替えます）</p>
      <h2>第4条（禁止事項）</h2>
      <p>（本文は後で差し替えます）</p>
      <h2>第5条（免責事項）</h2>
      <p>（本文は後で差し替えます）</p>
    </LegalPage>
  );
}
