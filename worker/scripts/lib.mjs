// スクリプト共通：パスワードのハッシュ化（Worker と同じ形式）と SQL の組み立て
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID, webcrypto } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ITERATIONS = 100_000;
const b64url = (buf) => Buffer.from(buf).toString("base64url");

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await webcrypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);
  return `pbkdf2_sha256$${ITERATIONS}$${b64url(salt)}$${b64url(bits)}`;
}

/** SQL 文字列リテラル（シングルクォートのエスケープ） */
export function q(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replace(/'/g, "''")}'`;
}

export const uuid = () => randomUUID();

/** 企業・企業設定・最初の管理者を作る SQL */
export async function orgSql({ orgName, adminName, email, password, orgId = uuid(), userId = uuid() }) {
  const now = Date.now();
  const hash = await hashPassword(password);
  return {
    orgId,
    userId,
    sql: [
      `INSERT INTO organizations (id, name) VALUES (${q(orgId)}, ${q(orgName)});`,
      `INSERT INTO organization_settings (organization_id, company_name) VALUES (${q(orgId)}, ${q(orgName)});`,
      `INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (${q(userId)}, ${q(adminName)}, ${q(email.toLowerCase())}, 1, ${now}, ${now});`,
      `INSERT INTO accounts (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (${q(uuid())}, ${q(userId)}, 'credential', ${q(userId)}, ${q(hash)}, ${now}, ${now});`,
      `INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES (${q(uuid())}, ${q(orgId)}, ${q(userId)}, 'admin');`,
    ],
  };
}

export async function userSql({ orgId, name, email, password, role = "member" }) {
  const now = Date.now();
  const userId = uuid();
  const hash = await hashPassword(password);
  return [
    `INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (${q(userId)}, ${q(name)}, ${q(email.toLowerCase())}, 1, ${now}, ${now});`,
    `INSERT INTO accounts (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (${q(uuid())}, ${q(userId)}, 'credential', ${q(userId)}, ${q(hash)}, ${now}, ${now});`,
    `INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES (${q(uuid())}, ${q(orgId)}, ${q(userId)}, ${q(role)});`,
  ];
}

/** SQL を一時ファイルに書いて wrangler d1 execute で実行する */
export function executeSql(statements, { remote = false, persistTo } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mitubei-"));
  const file = join(dir, "run.sql");
  writeFileSync(file, statements.join("\n") + "\n");
  const args = ["wrangler", "d1", "execute", "mitubei", remote ? "--remote" : "--local", "--file", file, "--yes"];
  if (persistTo) args.push("--persist-to", persistTo);
  execFileSync("npx", args, { stdio: "inherit" });
}
