import type { Db } from "./db";
import { newId, now } from "./util";

export interface AuditInput {
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordAudit(db: Db, input: AuditInput): Promise<void> {
  try {
    await db.run(
      `INSERT INTO audit_logs (id, actor_user_id, actor_email, action, target_type, target_id, ip, user_agent, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId("aud"),
        input.actorUserId ?? null,
        input.actorEmail ?? null,
        input.action.slice(0, 120),
        input.targetType ?? "",
        input.targetId ?? "",
        input.ip ?? null,
        input.userAgent ?? null,
        JSON.stringify(input.metadata ?? {}),
        now(),
      ],
    );
  } catch (error) {
    // Auditing must never break the primary operation, but it must be visible.
    console.error("[audit] failed to write audit log", error);
  }
}

export async function recordProviderError(
  db: Db,
  input: {
    providerId?: string | null;
    modelId?: string | null;
    generationId?: string | null;
    httpStatus?: number | null;
    code?: string | null;
    message: string;
  },
): Promise<void> {
  try {
    await db.run(
      `INSERT INTO provider_error_events (id, provider_id, model_id, generation_id, http_status, code, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId("perr"),
        input.providerId ?? null,
        input.modelId ?? null,
        input.generationId ?? null,
        input.httpStatus ?? null,
        input.code ?? null,
        input.message.slice(0, 1000),
        now(),
      ],
    );
  } catch (error) {
    console.error("[provider] failed to record error", error);
  }
}
