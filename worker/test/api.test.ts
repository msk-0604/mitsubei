/**
 * API の結合テスト（本物の Worker + 使い捨てのローカル D1）
 *  - 認証・ログアウト・不正ログイン対策
 *  - 企業間のデータ分離（他社の見積書・価格表・顧客・ロゴを取得・変更できない）
 *  - 管理者・一般社員の権限
 *  - 見積書番号の同時採番、発行済みの上書き防止、楽観ロック
 *  - 価格表から追加した単価の固定、CSV 一括登録
 */
import { beforeAll, describe, expect, inject, it } from "vitest";

const BASE = inject("baseUrl");
const SECRET = inject("secret");
const ORIGIN = "http://localhost:3000";

type Session = { cookie: string; label: string };

async function call(
  s: Session | null,
  method: string,
  path: string,
  body?: unknown,
  opts: { origin?: string | null; secret?: string | null; ip?: string } = {},
) {
  const headers: Record<string, string> = { "x-mitubei-client-ip": opts.ip ?? "10.0.0.1" };
  if (opts.secret !== null) headers["x-mitubei-internal-secret"] = opts.secret ?? SECRET;
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  if (s) headers.cookie = s.cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

async function login(email: string, password: string, ip = "10.0.0.1"): Promise<Session> {
  const res = await fetch(BASE + "/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", "x-mitubei-internal-secret": SECRET, origin: ORIGIN, "x-mitubei-client-ip": ip },
    body: JSON.stringify({ email, password }),
  });
  expect(res.status, `login ${email}`).toBe(200);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  expect(cookie).toContain("mitubei.session_token=");
  return { cookie, label: email };
}

const item = (name: string, quantity: string, unitPrice: string, taxCategory = "standard", priceItemId: string | null = null) => ({
  name,
  quantity,
  unitPrice,
  taxCategory,
  priceItemId,
});

let A: Session; // 山田設備工業 管理者
let staff: Session; // 山田設備工業 一般社員
let B: Session; // 別会社建設 管理者

let aEstimate: any;
let aCustomerId: string;
let aPriceItemId: string;

beforeAll(async () => {
  [A, staff, B] = await Promise.all([
    login("demo@example.com", "mitubei-demo-2026"),
    login("staff@example.com", "mitubei-staff-2026"),
    login("other@example.com", "mitubei-other-2026"),
  ]);
  const customers = await call(A, "GET", "/api/customers?q=青葉");
  aCustomerId = customers.json.items[0].id;
  const prices = await call(A, "GET", "/api/price-items?q=P-VP20");
  aPriceItemId = prices.json.items[0].id;
  const created = await call(A, "POST", "/api/estimates", {
    issueDate: "2026-11-12",
    customerId: aCustomerId,
    recipientName: "株式会社 青葉不動産",
    subject: "A社の見積書",
    items: [item("給水管 VP20", "10", "1800", "standard", aPriceItemId)],
  });
  expect(created.status).toBe(201);
  aEstimate = created.json;
});

describe("認証", () => {
  it("内部用の秘密値がないリクエストは拒否する", async () => {
    expect((await call(A, "GET", "/api/me", undefined, { secret: null })).status).toBe(401);
    expect((await call(A, "GET", "/api/me", undefined, { secret: "wrong-secret-wrong-secret" })).status).toBe(401);
  });

  it("ログインしていなければ 401", async () => {
    const r = await call(null, "GET", "/api/estimates");
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("unauthenticated");
  });

  it("誤ったパスワードではログインできない", async () => {
    const r = await call(null, "POST", "/api/auth/sign-in/email", { email: "demo@example.com", password: "wrong-password" });
    expect(r.status).toBe(401);
  });

  it("自己登録（サインアップ）はできない", async () => {
    const r = await call(null, "POST", "/api/auth/sign-up/email", { email: "new@example.com", password: "abcdefghijkl", name: "x" });
    expect(r.status).not.toBe(200);
  });

  it("同じメールアドレスへの試行が続くとロックする（15分で10回まで）", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      // IP 単位の制限と区別するため、毎回別の IP から試す
      const r = await call(null, "POST", "/api/auth/sign-in/email", { email: "nobody@example.com", password: "wrong-password" }, { ip: `10.1.0.${i + 1}` });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("ログイン中のユーザーと所属企業・権限を返す", async () => {
    const me = await call(A, "GET", "/api/me");
    expect(me.json.organization.name).toBe("山田設備工業（テスト）");
    expect(me.json.role).toBe("admin");
    const s = await call(staff, "GET", "/api/me");
    expect(s.json.role).toBe("member");
    expect(s.json.permissions.editPrices).toBe(false);
  });

  it("ログアウトするとセッションが使えなくなる", async () => {
    const tmp = await login("staff@example.com", "mitubei-staff-2026", "10.0.0.9");
    expect((await call(tmp, "GET", "/api/me")).status).toBe(200);
    expect((await call(tmp, "POST", "/api/auth/sign-out", {})).status).toBe(200);
    expect((await call(tmp, "GET", "/api/me")).status).toBe(401);
  });
});

describe("CSRF 対策", () => {
  it("画面以外の Origin からの変更は拒否する", async () => {
    expect((await call(A, "POST", "/api/customers", { name: "x" }, { origin: "https://evil.example.com" })).status).toBe(403);
    expect((await call(A, "POST", "/api/customers", { name: "x" }, { origin: null })).status).toBe(403);
  });
});

describe("企業間のデータ分離", () => {
  it("他社の見積書は取得・編集・削除・PDF化できない（存在も明かさない）", async () => {
    const id = aEstimate.id;
    expect((await call(B, "GET", `/api/estimates/${id}`)).status).toBe(404);
    expect((await call(B, "GET", `/api/estimates/${id}/pdf-data`)).status).toBe(404);
    expect((await call(B, "PUT", `/api/estimates/${id}`, { version: 1, issueDate: "2026-11-12", items: [] })).status).toBe(404);
    expect((await call(B, "POST", `/api/estimates/${id}/issue`, { version: 1 })).status).toBe(404);
    expect((await call(B, "POST", `/api/estimates/${id}/duplicate`, {})).status).toBe(404);
    expect((await call(B, "POST", `/api/estimates/${id}/revise`, {})).status).toBe(404);
    expect((await call(B, "DELETE", `/api/estimates/${id}`)).status).toBe(404);
    // A 社からは変わらず見える
    const r = await call(A, "GET", `/api/estimates/${id}`);
    expect(r.status).toBe(200);
    expect(r.json.subject).toBe("A社の見積書");
  });

  it("一覧・検索・集計には自社のデータだけが出る", async () => {
    const b = await call(B, "GET", "/api/estimates?q=A社");
    expect(b.json.total).toBe(0);
    const bDash = await call(B, "GET", "/api/dashboard");
    expect(bDash.json.recent.every((e: any) => e.id !== aEstimate.id)).toBe(true);

    const bPrices = await call(B, "GET", "/api/price-items?pageSize=100&active=all");
    expect(bPrices.json.items.map((i: any) => i.name)).toEqual(["給水管 VP20（別会社）"]);
    const aPrices = await call(A, "GET", "/api/price-items?q=P-VP20");
    expect(aPrices.json.items.every((i: any) => !i.name.includes("別会社"))).toBe(true);

    const bCustomers = await call(B, "GET", "/api/customers?q=青葉");
    expect(bCustomers.json.items).toHaveLength(1);
    expect(bCustomers.json.items[0].name).toContain("別会社");
  });

  it("他社の顧客・価格表は取得・変更・削除できない", async () => {
    expect((await call(B, "GET", `/api/customers/${aCustomerId}`)).status).toBe(404);
    expect((await call(B, "PATCH", `/api/customers/${aCustomerId}`, { name: "乗っ取り" })).status).toBe(404);
    expect((await call(B, "DELETE", `/api/customers/${aCustomerId}`)).status).toBe(404);
    expect((await call(B, "GET", `/api/price-items/${aPriceItemId}`)).status).toBe(404);
    expect((await call(B, "PATCH", `/api/price-items/${aPriceItemId}`, { name: "x", unitPrice: "1" })).status).toBe(404);
    expect((await call(B, "DELETE", `/api/price-items/${aPriceItemId}`)).status).toBe(404);
    const still = await call(A, "GET", `/api/price-items/${aPriceItemId}`);
    expect(still.json.unitPrice).toBe("1800");
  });

  it("他社の顧客を宛先に指定した見積書は作れない", async () => {
    const r = await call(B, "POST", "/api/estimates", { issueDate: "2026-11-12", customerId: aCustomerId, items: [] });
    expect(r.status).toBe(400);
    expect(r.json.error.details.customerId).toBeTruthy();
  });

  it("他社のカテゴリを価格表に設定できない", async () => {
    const cats = await call(A, "GET", "/api/price-categories");
    const aCat = cats.json.items[0].id;
    const r = await call(B, "POST", "/api/price-items", { name: "x", unitPrice: "1", categoryId: aCat });
    expect(r.status).toBe(400);
  });

  it("リクエストに他社の organizationId を混ぜても無視される", async () => {
    const aMe = await call(A, "GET", "/api/me");
    const r = await call(B, "POST", "/api/customers", { name: "B社の顧客", organizationId: aMe.json.organization.id });
    expect(r.status).toBe(201);
    expect((await call(A, "GET", `/api/customers/${r.json.id}`)).status).toBe(404);
    expect((await call(B, "GET", `/api/customers/${r.json.id}`)).status).toBe(200);
  });

  it("他社のロゴ画像は取得できない", async () => {
    const png = Uint8Array.from(
      atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
      (c) => c.charCodeAt(0),
    );
    const up = await fetch(BASE + "/api/settings/logo", {
      method: "POST",
      headers: { "x-mitubei-internal-secret": SECRET, origin: ORIGIN, cookie: A.cookie, "content-type": "image/png" },
      body: png,
    });
    expect(up.status).toBe(200);
    const { logoId } = (await up.json()) as { logoId: string };
    expect((await call(A, "GET", `/api/logos/${logoId}`)).status).toBe(200);
    expect((await call(B, "GET", `/api/logos/${logoId}`)).status).toBe(404);
  });
});

describe("権限（管理者・一般社員）", () => {
  it("一般社員は価格表を編集できない（設定で許可すると編集できる）", async () => {
    expect((await call(staff, "POST", "/api/price-items", { name: "x", unitPrice: "1" })).status).toBe(403);
    expect((await call(staff, "PATCH", `/api/price-items/${aPriceItemId}`, { name: "x", unitPrice: "1" })).status).toBe(403);
    expect((await call(staff, "POST", "/api/price-items/import", { onDuplicate: "skip", rows: [{ name: "x", unitPrice: "1" }] })).status).toBe(403);
    // 閲覧はできる
    expect((await call(staff, "GET", "/api/price-items")).status).toBe(200);

    const settings = (await call(A, "GET", "/api/settings")).json;
    expect((await call(A, "PUT", "/api/settings", { ...settings, memberCanEditPrices: true })).status).toBe(200);
    const created = await call(staff, "POST", "/api/price-items", { name: "社員が登録", unitPrice: "100" });
    expect(created.status).toBe(201);
    expect((await call(A, "PUT", "/api/settings", { ...settings, memberCanEditPrices: false })).status).toBe(200);
    expect((await call(staff, "DELETE", `/api/price-items/${created.json.id}`)).status).toBe(403);
  });

  it("一般社員は企業設定・社員管理・操作ログを使えない", async () => {
    const settings = (await call(A, "GET", "/api/settings")).json;
    expect((await call(staff, "PUT", "/api/settings", settings)).status).toBe(403);
    expect((await call(staff, "GET", "/api/members")).status).toBe(403);
    expect((await call(staff, "POST", "/api/members", { name: "x", email: "x@example.com", password: "abcdefghijk", role: "admin" })).status).toBe(403);
    expect((await call(staff, "GET", "/api/audit-logs")).status).toBe(403);
  });

  it("一般社員はほかの人の下書きと発行済みの見積書を削除できない。管理者はできる", async () => {
    const draft = await call(A, "POST", "/api/estimates", { issueDate: "2026-11-12", items: [] });
    expect((await call(staff, "DELETE", `/api/estimates/${draft.json.id}`)).status).toBe(403);
    const own = await call(staff, "POST", "/api/estimates", { issueDate: "2026-11-12", items: [] });
    expect((await call(staff, "DELETE", `/api/estimates/${own.json.id}`)).status).toBe(200);
    expect((await call(A, "DELETE", `/api/estimates/${draft.json.id}`)).status).toBe(200);
    expect((await call(A, "GET", `/api/estimates/${draft.json.id}`)).status).toBe(404);
  });

  it("管理者は社員を追加・停止できる。停止された社員は使えなくなる", async () => {
    const add = await call(A, "POST", "/api/members", { name: "新人 太郎", email: "newbie@example.com", password: "newbie-pass-2026", role: "member" });
    expect(add.status).toBe(201);
    const member = add.json.items.find((m: any) => m.email === "newbie@example.com");
    const s = await login("newbie@example.com", "newbie-pass-2026", "10.0.0.20");
    expect((await call(s, "GET", "/api/me")).json.organization.name).toBe("山田設備工業（テスト）");
    expect((await call(A, "PATCH", `/api/members/${member.id}`, { status: "disabled" })).status).toBe(200);
    expect((await call(s, "GET", "/api/me")).status).toBe(401);
    const relogin = await call(null, "POST", "/api/auth/sign-in/email", { email: "newbie@example.com", password: "newbie-pass-2026" }, { ip: "10.0.0.21" });
    expect(relogin.status).not.toBe(200);
    // 他社の管理者はこの社員を操作できない
    expect((await call(B, "PATCH", `/api/members/${member.id}`, { status: "active" })).status).toBe(404);
  });

  it("最後の管理者は降格できない", async () => {
    const list = await call(B, "GET", "/api/members");
    const self = list.json.items[0];
    expect((await call(B, "PATCH", `/api/members/${self.id}`, { role: "member" })).status).toBe(400);
  });
});

describe("見積書", () => {
  it("金額はサーバーで計算し直す（送られた金額は使わない）", async () => {
    const r = await call(A, "POST", "/api/estimates", {
      issueDate: "2026-11-12",
      discount: 1000,
      items: [
        { ...item("給水管", "12.5", "1800"), amount: 1 },
        item("飲料", "3", "150.5", "reduced"),
        item("申請手数料", "1", "2500", "exempt"),
      ],
    });
    expect(r.status).toBe(201);
    expect(r.json.items.map((i: any) => i.amount)).toEqual([22500, 451, 2500]);
    expect(r.json.itemsSubtotal).toBe(25451);
    expect(r.json.tax).toBe(2195);
    expect(r.json.total).toBe(26646);
    expect(r.json.taxGroups.map((g: any) => [g.category, g.taxable, g.tax])).toEqual([
      ["standard", 21616, 2161],
      ["reduced", 433, 34],
      ["exempt", 2402, 0],
    ]);
  });

  it("入力値を検証する", async () => {
    const bad = await call(A, "POST", "/api/estimates", { issueDate: "2026-02-30", items: [item("", "abc", "1.234")] });
    expect(bad.status).toBe(400);
    const d = bad.json.error.details;
    expect(d.issueDate).toBeTruthy();
    expect(d["items.0.name"]).toBeTruthy();
    expect(d["items.0.quantity"]).toBeTruthy();
    expect(d["items.0.unitPrice"]).toBeTruthy();
    const over = await call(A, "POST", "/api/estimates", { issueDate: "2026-11-12", discount: 5000, items: [item("a", "1", "1000")] });
    expect(over.status).toBe(400);
    expect(over.json.error.details.discount).toBeTruthy();
  });

  it("同時に作成しても見積書番号が重複しない", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => call(A, "POST", "/api/estimates", { issueDate: "2027-01-05", items: [] })),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.json.estimateNumber).sort();
    expect(new Set(numbers).size).toBe(20);
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => `2027-${String(i + 1).padStart(4, "0")}`));
  });

  it("手入力の番号が重複したら 409、手入力済みの番号は自動採番でも飛ばす", async () => {
    const used = await call(A, "POST", "/api/estimates", { estimateNumber: "2028-0001", issueDate: "2028-01-01", items: [] });
    expect(used.status).toBe(201);
    const dup = await call(A, "POST", "/api/estimates", { estimateNumber: "2028-0001", issueDate: "2028-01-01", items: [] });
    expect(dup.status).toBe(409);
    const auto = await call(A, "POST", "/api/estimates", { issueDate: "2028-03-01", items: [] });
    expect(auto.json.estimateNumber).toBe("2028-0002");
    // 別会社の番号は独立（同じ番号を使える）
    const b = await call(B, "POST", "/api/estimates", { issueDate: "2028-03-01", items: [] });
    expect(b.json.estimateNumber).toBe("2028-0001");
  });

  it("古い版での保存は 409（同時編集の上書きを防ぐ）", async () => {
    const c = await call(A, "POST", "/api/estimates", { issueDate: "2026-11-12", subject: "v1", items: [] });
    const body = { issueDate: "2026-11-12", items: [] };
    const first = await call(A, "PUT", `/api/estimates/${c.json.id}`, { ...body, subject: "v2", version: c.json.version });
    expect(first.status).toBe(200);
    const stale = await call(A, "PUT", `/api/estimates/${c.json.id}`, { ...body, subject: "v3", version: c.json.version });
    expect(stale.status).toBe(409);
    expect((await call(A, "GET", `/api/estimates/${c.json.id}`)).json.subject).toBe("v2");
  });

  it("発行後は上書きできず、改訂版・複製で新しい見積書を作る", async () => {
    const c = await call(A, "POST", "/api/estimates", {
      issueDate: "2026-11-12",
      recipientName: "伊藤 健一",
      recipientHonorific: "様",
      subject: "発行テスト",
      items: [item("配管施工費", "1", "25000")],
    });
    // 宛先・件名がないと発行できない
    const empty = await call(A, "POST", "/api/estimates", { issueDate: "2026-11-12", items: [] });
    expect((await call(A, "POST", `/api/estimates/${empty.json.id}/issue`, { version: 1 })).status).toBe(400);

    const issued = await call(A, "POST", `/api/estimates/${c.json.id}/issue`, { version: c.json.version });
    expect(issued.status).toBe(200);
    expect(issued.json.status).toBe("issued");
    expect(issued.json.issuer.companyName).toBe("山田設備工業（テスト）");

    const edit = await call(A, "PUT", `/api/estimates/${c.json.id}`, { issueDate: "2026-11-12", items: [], version: issued.json.version });
    expect(edit.status).toBe(409);
    expect((await call(A, "POST", `/api/estimates/${c.json.id}/issue`, { version: issued.json.version })).status).toBe(409);

    const won = await call(A, "POST", `/api/estimates/${c.json.id}/status`, { status: "won" });
    expect(won.json.status).toBe("won");

    const rev = await call(A, "POST", `/api/estimates/${c.json.id}/revise`, {});
    expect(rev.status).toBe(201);
    expect(rev.json.status).toBe("draft");
    expect(rev.json.estimateNumber).toBe(`${c.json.estimateNumber}-R1`);
    expect(rev.json.rootEstimateId).toBe(c.json.id);
    expect(rev.json.revisions.map((r: any) => r.id)).toEqual([c.json.id, rev.json.id]);
    const rev2 = await call(A, "POST", `/api/estimates/${c.json.id}/revise`, {});
    expect(rev2.json.estimateNumber).toBe(`${c.json.estimateNumber}-R2`);

    const dup = await call(A, "POST", `/api/estimates/${c.json.id}/duplicate`, {});
    expect(dup.status).toBe(201);
    expect(dup.json.status).toBe("draft");
    expect(dup.json.estimateNumber).not.toBe(c.json.estimateNumber);
    expect(dup.json.total).toBe(issued.json.total);

    // 元の見積書は変わらない
    const orig = await call(A, "GET", `/api/estimates/${c.json.id}`);
    expect(orig.json.status).toBe("won");
    expect(orig.json.items).toHaveLength(1);
  });

  it("価格表の単価を変えても、作成済みの見積書の金額は変わらない", async () => {
    const before = await call(A, "GET", `/api/estimates/${aEstimate.id}`);
    expect(before.json.items[0].unitPrice).toBe("1800");
    const pi = (await call(A, "GET", `/api/price-items/${aPriceItemId}`)).json;
    await call(A, "PATCH", `/api/price-items/${aPriceItemId}`, { ...pi, unitPrice: "2500" });
    const after = await call(A, "GET", `/api/estimates/${aEstimate.id}`);
    expect(after.json.items[0].unitPrice).toBe("1800");
    expect(after.json.total).toBe(before.json.total);
    await call(A, "PATCH", `/api/price-items/${aPriceItemId}`, { ...pi, unitPrice: "1800" });
  });

  it("発行済みの宛先・自社情報は、顧客や企業設定を変えても変わらない", async () => {
    const c = await call(A, "POST", "/api/estimates", {
      issueDate: "2026-11-12",
      customerId: aCustomerId,
      recipientName: "株式会社 青葉不動産",
      subject: "スナップショット",
      items: [item("a", "1", "100")],
    });
    await call(A, "POST", `/api/estimates/${c.json.id}/issue`, { version: c.json.version });
    const cust = (await call(A, "GET", `/api/customers/${aCustomerId}`)).json;
    await call(A, "PATCH", `/api/customers/${aCustomerId}`, { ...cust, name: "株式会社 青葉ホールディングス" });
    const settings = (await call(A, "GET", "/api/settings")).json;
    await call(A, "PUT", "/api/settings", { ...settings, phone: "03-9999-9999" });

    const pdf = await call(A, "GET", `/api/estimates/${c.json.id}/pdf-data`);
    expect(pdf.json.estimate.recipientName).toBe("株式会社 青葉不動産");
    expect(pdf.json.issuer.phone).toBe("03-1234-5678");

    await call(A, "PATCH", `/api/customers/${aCustomerId}`, cust);
    await call(A, "PUT", "/api/settings", settings);
  });

  it("履歴の検索・絞り込み・ページ分割", async () => {
    const byStatus = await call(A, "GET", "/api/estimates?status=won");
    expect(byStatus.json.items.every((e: any) => e.status === "won")).toBe(true);
    const byDate = await call(A, "GET", "/api/estimates?from=2027-01-01&to=2027-12-31&pageSize=5&page=2");
    expect(byDate.json.total).toBe(20);
    expect(byDate.json.items).toHaveLength(5);
    expect(byDate.json.items.every((e: any) => e.issueDate.startsWith("2027"))).toBe(true);
    const byWord = await call(A, "GET", "/api/estimates?q=" + encodeURIComponent("発行テスト"));
    expect(byWord.json.total).toBeGreaterThanOrEqual(1);
    // LIKE の特殊文字はそのまま文字として扱う
    const pct = await call(A, "GET", "/api/estimates?q=%25");
    expect(pct.json.total).toBe(0);
  });
});

describe("価格表", () => {
  it("検索・カテゴリ絞り込み・価格順", async () => {
    const r = await call(A, "GET", "/api/price-items?q=" + encodeURIComponent("給水管") + "&sort=price_desc");
    const prices = r.json.items.map((i: any) => Number(i.unitPrice));
    expect(prices.length).toBeGreaterThan(1);
    expect([...prices].sort((a, b) => b - a)).toEqual(prices);
    const cats = (await call(A, "GET", "/api/price-categories")).json.items;
    const joint = cats.find((c: any) => c.name === "継手");
    const byCat = await call(A, "GET", `/api/price-items?categoryId=${joint.id}`);
    expect(byCat.json.items.every((i: any) => i.categoryName === "継手")).toBe(true);
  });

  it("商品コードは企業内で重複できない（別会社とは重複してよい）", async () => {
    expect((await call(A, "POST", "/api/price-items", { code: "P-VP20", name: "dup", unitPrice: "1" })).status).toBe(409);
    expect((await call(B, "POST", "/api/price-items", { code: "P-VP13", name: "B社の VP13", unitPrice: "1" })).status).toBe(201);
  });

  it("CSV 一括登録：新規・上書き・カテゴリ自動作成・税区分の表記ゆれ", async () => {
    const r = await call(A, "POST", "/api/price-items/import", {
      onDuplicate: "overwrite",
      rows: [
        { code: "CSV-001", name: "CSV 商品1", category: "CSVカテゴリ", unit: "個", unitPrice: "1,200", taxCategory: "10%" },
        { code: "CSV-002", name: "CSV 商品2", category: "CSVカテゴリ", unit: "本", unitPrice: "¥98.5", taxCategory: "軽減" },
        { code: "P-VP13", name: "給水管 VP13（CSVで更新）", unit: "m", unitPrice: "1300", taxCategory: "" },
        { code: "", name: "コードなし商品", unitPrice: "500", taxCategory: "非課税" },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ created: 3, updated: 1, skipped: 0, categoriesCreated: 1 });
    const two = (await call(A, "GET", "/api/price-items?q=CSV-002")).json.items[0];
    expect(two.unitPrice).toBe("98.5");
    expect(two.taxCategory).toBe("reduced");
    expect(two.categoryName).toBe("CSVカテゴリ");
    const vp13 = (await call(A, "GET", "/api/price-items?q=P-VP13")).json.items[0];
    expect(vp13.name).toBe("給水管 VP13（CSVで更新）");
    // B 社の P-VP13 は変わらない
    const bvp13 = (await call(B, "GET", "/api/price-items?q=P-VP13")).json.items[0];
    expect(bvp13.name).toBe("B社の VP13");
  });

  it("CSV 一括登録：スキップ指定と、不正な行があれば何も登録しない", async () => {
    const skip = await call(A, "POST", "/api/price-items/import", {
      onDuplicate: "skip",
      rows: [{ code: "CSV-001", name: "上書きされないはず", unitPrice: "1" }],
    });
    expect(skip.json).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    expect((await call(A, "GET", "/api/price-items?q=CSV-001")).json.items[0].name).toBe("CSV 商品1");

    const bad = await call(A, "POST", "/api/price-items/import", {
      onDuplicate: "overwrite",
      rows: [
        { code: "CSV-100", name: "正しい行", unitPrice: "100" },
        { code: "CSV-101", name: "", unitPrice: "100" },
        { code: "CSV-102", name: "単価が不正", unitPrice: "abc" },
        { code: "CSV-100", name: "コード重複", unitPrice: "1" },
        { code: "CSV-103", name: "税区分が不正", unitPrice: "1", taxCategory: "15%" },
      ],
    });
    expect(bad.status).toBe(400);
    expect(bad.json.error.details.rows.map((r: any) => r.row)).toEqual([2, 3, 4, 5]);
    expect((await call(A, "GET", "/api/price-items?q=CSV-100")).json.total).toBe(0);
  });

  it("CSV 出力は自社分だけ・数式の先頭文字をエスケープする", async () => {
    await call(A, "POST", "/api/price-items", { code: "=CMD", name: "=1+2", unitPrice: "1" });
    const r = await fetch(BASE + "/api/price-items/export", { headers: { "x-mitubei-internal-secret": SECRET, cookie: A.cookie } });
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect(r.headers.get("content-type")).toContain("text/csv");
    // Excel 用の UTF-8 BOM（text() は BOM を取り除くためバイト列で確認）
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith("商品コード,")).toBe(true);
    expect(text).toContain("'=CMD,'=1+2");
    expect(text).not.toContain("別会社");
  });
});
