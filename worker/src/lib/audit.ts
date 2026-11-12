import { schema, type DB } from "./db";
import type { AuthContext } from "./context";
import { newId } from "./http";

/**
 * 操作ログの INSERT 文を作る（db.batch に含めて本処理と同時に確定させる）。
 * detail には個人情報・金額を入れない（件数・ステータス・番号など）。
 */
export function auditStmt(
  db: DB,
  auth: AuthContext,
  action: string,
  entityType: string,
  entityId: string | null,
  detail?: Record<string, string | number | boolean | null>,
) {
  return db.insert(schema.auditLogs).values({
    id: newId(),
    organizationId: auth.organizationId,
    userId: auth.userId,
    action,
    entityType,
    entityId,
    detail: detail ? JSON.stringify(detail) : null,
  });
}
