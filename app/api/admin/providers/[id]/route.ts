import { auditRequest, guardMutation, requireAdmin, requireSuperAdmin } from "@/lib/server/context";
import { getProvider } from "@/lib/server/models";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { now, safeString } from "@/lib/server/util";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { db, actor } = await requireAdmin(request);
    await guardMutation(request, db, "admin-provider-update", 40, 60_000);
    const { id } = await params;
    const provider = await getProvider(db, id);
    if (!provider) throw new ApiError(404, "Provider not found.", "PROVIDER_NOT_FOUND");
    const body = await readJson<Record<string, unknown>>(request);
    const updates: Record<string, unknown> = { updated_at: now() };
    if (typeof body.name === "string") {
      const name = safeString(body.name, 60);
      if (!name) throw new ApiError(400, "Provider name cannot be empty.", "INVALID_NAME");
      updates.name = name;
    }
    if (typeof body.baseUrl === "string") updates.base_url = safeString(body.baseUrl, 300) || null;
    if (typeof body.isEnabled === "boolean") updates.is_enabled = body.isEnabled ? 1 : 0;
    if (body.sortOrder !== undefined) updates.sort_order = Number(body.sortOrder) || 0;
    const columns = Object.keys(updates);
    await db.run(
      `UPDATE ai_providers SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`,
      [...Object.values(updates), id] as Array<string | number | null>,
    );
    await auditRequest(db, request, actor, "admin.provider_updated", "provider", id, { fields: Object.keys(updates) });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const { db, actor } = await requireSuperAdmin(request);
    await guardMutation(request, db, "admin-provider-delete", 10, 60_000);
    const { id } = await params;
    const provider = await getProvider(db, id);
    if (!provider) throw new ApiError(404, "Provider not found.", "PROVIDER_NOT_FOUND");
    const models = await db.first<{ count: number }>(`SELECT COUNT(*) AS count FROM ai_models WHERE provider_id = ?`, [id]);
    if ((models?.count ?? 0) > 0) {
      throw new ApiError(409, "Delete or move this provider's models first, or disable the provider.", "PROVIDER_HAS_MODELS");
    }
    await db.batch([
      { sql: `DELETE FROM provider_credentials WHERE provider_id = ?`, params: [id] },
      { sql: `DELETE FROM ai_providers WHERE id = ?`, params: [id] },
    ]);
    await auditRequest(db, request, actor, "admin.provider_deleted", "provider", id, { code: provider.code });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
