import { requireAdmin } from "@/lib/server/context";
import { errorResponse, json } from "@/lib/server/http";
import { clampInt } from "@/lib/server/util";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { db } = await requireAdmin(request);
    const url = new URL(request.url);
    const limit = clampInt(url.searchParams.get("limit"), 1, 200, 100);
    const action = url.searchParams.get("action");
    const rows = await db.all<{
      id: string;
      actor_email: string | null;
      action: string;
      target_type: string;
      target_id: string;
      ip: string | null;
      metadata: string;
      created_at: number;
    }>(
      `SELECT * FROM audit_logs ${action ? "WHERE action LIKE ?" : ""} ORDER BY created_at DESC LIMIT ?`,
      action ? [`${action}%`, limit] : [limit],
    );
    return json({
      entries: rows.map((entry) => ({
        id: entry.id,
        actor: entry.actor_email,
        action: entry.action,
        targetType: entry.target_type,
        targetId: entry.target_id,
        ip: entry.ip,
        metadata: entry.metadata,
        createdAt: entry.created_at,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
