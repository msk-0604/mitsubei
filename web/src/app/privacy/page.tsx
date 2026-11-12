import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "プライバシーポリシー" };

export default function PrivacyPage() {
  return (
    <LegalPage title="プライバシーポリシー">
      <p>株式会社Stark Lab（以下「当社」）は、本サービスにおける利用者および利用者が登録する顧客の個人情報を、以下のとおり取り扱います。</p>
      <h2>1. 取得する情報</h2>
      <p>（本文は後で差し替えます）</p>
      <h2>2. 利用目的</h2>
      <p>（本文は後で差し替えます）</p>
      <h2>3. 第三者提供・委託</h2>
      <p>本サービスは、データの保存に Cloudflare（D1）、画面の配信に Vercel を利用しています。（本文は後で差し替えます）</p>
      <h2>4. 安全管理措置</h2>
      <p>（本文は後で差し替えます）</p>
      <h2>5. お問い合わせ窓口</h2>
      <p>（本文は後で差し替えます）</p>
    </LegalPage>
  );
}
