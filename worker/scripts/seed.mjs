#!/usr/bin/env node
/**
 * ローカル開発用のテストデータ（2社分）を作成する。本番では実行しないこと。
 *   npm run db:seed:local
 */
import { executeSql, orgSql, q, userSql, uuid } from "./lib.mjs";

const persistTo = process.argv.includes("--persist-to") ? process.argv[process.argv.indexOf("--persist-to") + 1] : undefined;

const a = await orgSql({ orgName: "山田設備工業（テスト）", adminName: "山田 太郎", email: "demo@example.com", password: "mitubei-demo-2026" });
const staff = await userSql({ orgId: a.orgId, name: "佐藤 花子", email: "staff@example.com", password: "mitubei-staff-2026" });
const b = await orgSql({ orgName: "別会社建設（テスト）", adminName: "鈴木 一郎", email: "other@example.com", password: "mitubei-other-2026" });

const sql = [
  "DELETE FROM audit_logs; DELETE FROM estimate_revisions; DELETE FROM estimate_items; DELETE FROM estimates; DELETE FROM estimate_number_counters;",
  "DELETE FROM price_items; DELETE FROM price_categories; DELETE FROM customers; UPDATE organization_settings SET logo_id = NULL; DELETE FROM organization_logos;",
  "DELETE FROM organization_settings; DELETE FROM organization_memberships; DELETE FROM sessions; DELETE FROM accounts; DELETE FROM users;",
  "DELETE FROM organizations; DELETE FROM rate_limits; DELETE FROM login_attempts; DELETE FROM verifications;",
  ...a.sql,
  ...staff,
  ...b.sql,
  `UPDATE organization_settings SET postal_code = '160-0023', address = '東京都新宿区西新宿1-1-1 テストビル3F', phone = '03-1234-5678',
     email = 'info@example.com', registration_number = 'T1234567890123', bank_info = '〇〇銀行 新宿支店 普通 1234567 ヤマダセツビコウギョウ（カ',
     default_notes = '・本見積書の有効期限内にご発注ください。\n・記載のない工事は別途お見積りいたします。'
   WHERE organization_id = ${q(a.orgId)};`,
];

const categories = {
  配管材料: [
    ["P-VP13", "給水管 VP13", "JIS K 6741", "m", 1200],
    ["P-VP20", "給水管 VP20", "JIS K 6741", "m", 1800],
    ["P-VP25", "給水管 VP25", "JIS K 6741", "m", 2300],
    ["P-HIVP20", "耐衝撃給水管 HIVP20", "", "m", 2100],
    ["P-VU50", "排水管 VU50", "", "m", 1500],
    ["P-VU75", "排水管 VU75", "", "m", 2200],
    ["P-VU100", "排水管 VU100", "", "m", 2900],
    ["P-SUS20", "ステンレスフレキ管 20A", "", "m", 3200],
  ],
  継手: [
    ["J-20A-EL", "継手 20A エルボ", "DV", "個", 650],
    ["J-20A-T", "継手 20A チーズ", "DV", "個", 720],
    ["J-25A-EL", "継手 25A エルボ", "DV", "個", 780],
    ["J-50-LL", "排水継手 50 LL", "", "個", 900],
    ["J-75-Y", "排水継手 75 Y", "", "個", 1450],
  ],
  設備機器: [
    ["E-WH01", "ガス給湯器 24号", "オート・屋外壁掛", "台", 168000],
    ["E-TOI01", "洋風便器（節水型）", "", "台", 98000],
    ["E-SINK01", "洗面化粧台 W750", "", "台", 85000],
    ["E-FAU01", "シングルレバー混合水栓", "", "個", 24800],
  ],
  施工費: [
    ["L-PIPE", "配管施工費", "", "人工", 25000],
    ["L-HELP", "配管施工費（補助）", "", "人工", 18000],
    ["L-WH", "給湯器交換工事", "既存撤去含む", "式", 45000],
    ["L-TOI", "便器交換工事", "既存撤去含む", "式", 38000],
    ["L-DIG", "掘削・埋戻し", "", "m", 4500],
  ],
  諸経費: [
    ["X-MISC", "諸経費", "", "式", 10000],
    ["X-WASTE", "産業廃棄物処分費", "", "式", 15000],
    ["X-PARK", "駐車場代", "実費", "日", 1500.5],
  ],
};

let order = 0;
for (const [cat, items] of Object.entries(categories)) {
  const catId = uuid();
  sql.push(`INSERT INTO price_categories (id, organization_id, name, sort_order) VALUES (${q(catId)}, ${q(a.orgId)}, ${q(cat)}, ${order++});`);
  for (const [code, name, spec, unit, price] of items) {
    sql.push(
      `INSERT INTO price_items (id, organization_id, code, name, category_id, spec, unit, unit_price_x100, tax_category)
       VALUES (${q(uuid())}, ${q(a.orgId)}, ${q(code)}, ${q(name)}, ${q(catId)}, ${q(spec || null)}, ${q(unit)}, ${Math.round(price * 100)}, 'standard');`,
    );
  }
}
// 軽減税率・非課税の例
sql.push(
  `INSERT INTO price_items (id, organization_id, code, name, unit, unit_price_x100, tax_category) VALUES (${q(uuid())}, ${q(a.orgId)}, 'F-TEA', '作業員用 飲料（差入れ）', '本', 15000, 'reduced');`,
  `INSERT INTO price_items (id, organization_id, code, name, unit, unit_price_x100, tax_category) VALUES (${q(uuid())}, ${q(a.orgId)}, 'G-FEE', '道路使用許可 申請手数料', '件', 250000, 'exempt');`,
);

const customers = [
  ["株式会社 青葉不動産", "御中", "高橋 様", "03-1111-2222", "東京都渋谷区神南1-2-3"],
  ["さくら管理組合", "御中", "理事長 田中 様", "045-222-3333", "神奈川県横浜市中区本町4-5"],
  ["伊藤 健一", "様", null, "090-1234-5678", "東京都世田谷区桜新町2-8-1"],
  ["有限会社 ミナト工務店", "御中", "小林 様", "03-3333-4444", "東京都港区芝5-6-7"],
  ["中村 由美", "様", null, "080-9876-5432", "埼玉県さいたま市浦和区高砂3-1"],
];
for (const [name, hon, contact, phone, address] of customers) {
  sql.push(
    `INSERT INTO customers (id, organization_id, name, honorific, contact_name, phone, address) VALUES (${q(uuid())}, ${q(a.orgId)}, ${q(name)}, ${q(hon)}, ${q(contact)}, ${q(phone)}, ${q(address)});`,
  );
}
// 別会社にも同じ名前の商品・顧客を入れておく（企業間で混ざらないことの確認用）
sql.push(
  `INSERT INTO price_items (id, organization_id, code, name, unit, unit_price_x100, tax_category) VALUES (${q(uuid())}, ${q(b.orgId)}, 'P-VP20', '給水管 VP20（別会社）', 'm', 999900, 'standard');`,
  `INSERT INTO customers (id, organization_id, name, honorific) VALUES (${q(uuid())}, ${q(b.orgId)}, '株式会社 青葉不動産（別会社の顧客）', '御中');`,
);

executeSql(sql, { persistTo });
console.log(`
テスト用データを作成しました。
  山田設備工業（テスト） 管理者   demo@example.com  / mitubei-demo-2026
                         一般社員 staff@example.com / mitubei-staff-2026
  別会社建設（テスト）   管理者   other@example.com / mitubei-other-2026
`);
