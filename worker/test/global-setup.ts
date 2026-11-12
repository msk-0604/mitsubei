/**
 * 結合テスト用：使い捨てのローカル D1 を作り、マイグレーションとテスト用データを入れてから
 * 本物の Worker（wrangler dev）を起動する。開発用のローカル DB には触れない。
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import "./provided.d.ts";

export const TEST_PORT = 8799;
export const TEST_SECRET = "test-internal-secret-0123456789abcdef";

let proc: ChildProcess | null = null;
let dir = "";

export default async function setup(project: TestProject) {
  dir = mkdtempSync(join(tmpdir(), "mitubei-test-"));
  const cwd = join(import.meta.dirname, "..");
  // wrangler の利用統計の送信は止める
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };
  const run = (args: string[]) => execFileSync("npx", args, { cwd, stdio: "pipe", env });
  run(["wrangler", "d1", "migrations", "apply", "mitubei", "--local", "--persist-to", dir]);
  run(["node", "scripts/seed.mjs", "--persist-to", dir]);

  proc = spawn(
    "npx",
    [
      "wrangler", "dev", "--port", String(TEST_PORT), "--persist-to", dir, "--ip", "127.0.0.1",
      "--var", `INTERNAL_API_SECRET:${TEST_SECRET}`,
      "--var", "BETTER_AUTH_SECRET:test-better-auth-secret-0123456789abcdef",
      "--var", "APP_ORIGINS:http://localhost:3000",
    ],
    { cwd, stdio: "pipe", detached: true, env },
  );
  let log = "";
  proc.stdout?.on("data", (d: Buffer) => (log += d));
  proc.stderr?.on("data", (d: Buffer) => (log += d));

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
      if (r.ok) break;
    } catch {
      // 起動待ち
    }
    if (Date.now() > deadline) throw new Error("テスト用 Worker が起動しませんでした\n" + log.slice(-2000));
    await new Promise((r) => setTimeout(r, 300));
  }
  project.provide("baseUrl", `http://127.0.0.1:${TEST_PORT}`);
  project.provide("secret", TEST_SECRET);

  return () => {
    if (proc?.pid) {
      try {
        process.kill(-proc.pid, "SIGTERM");
      } catch {
        // 終了済み
      }
    }
    rmSync(dir, { recursive: true, force: true });
  };
}

