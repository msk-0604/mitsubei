#!/usr/bin/env node
/**
 * 企業（契約先）と最初の管理者アカウントを作成する（運営者用）。
 *
 *   MITUBEI_PASSWORD='10文字以上' npm run org:create -- --org "株式会社〇〇" --name "山田 太郎" --email you@example.com [--remote]
 *
 * パスワードはコマンド履歴に残らないよう、環境変数 MITUBEI_PASSWORD で渡す。
 * --remote を付けると本番の D1 に作成する（Cloudflare にログイン済みであること）。
 */
import { parseArgs } from "node:util";
import { executeSql, orgSql } from "./lib.mjs";

const { values } = parseArgs({
  options: {
    org: { type: "string" },
    name: { type: "string" },
    email: { type: "string" },
    remote: { type: "boolean", default: false },
  },
});
const password = process.env.MITUBEI_PASSWORD ?? "";
if (!values.org || !values.name || !values.email) {
  console.error('使い方: MITUBEI_PASSWORD=... npm run org:create -- --org "会社名" --name "氏名" --email メールアドレス [--remote]');
  process.exit(1);
}
if (password.length < 10) {
  console.error("MITUBEI_PASSWORD に10文字以上のパスワードを設定してください");
  process.exit(1);
}
const { orgId, sql } = await orgSql({ orgName: values.org, adminName: values.name, email: values.email, password });
executeSql(sql, { remote: values.remote });
console.log(`作成しました：企業ID ${orgId}`);
