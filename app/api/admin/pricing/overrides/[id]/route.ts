import { auditRequest, guardMutation, requireAdmin } from "@/lib/server/context";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { now, safeString } from "@/lib/server/util";
import { GENERATION_TYPES } from "@/lib/server/pricing";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { db, actor } = await requireAdmin(request);
    await guardMutation(request, db, "admin-override-update", 40, 60_000);
    const { id } = await params;
    const existing = await db.first<{ id: string }>(`SELECT id FROM pricing_overrides WHERE id = ?`, [id]);
    if (!existing) throw new ApiError(404, "Pricing rule not found.", "OVERRIDE_NOT_FOUND");
    const body = await readJson<Record<string, unknown>>(request);
    const updates: Record<string, unknown> = { updated_at: now(), version: 1 };
    if (typeof body.label === "string") updates.label = safeString(body.label, 100);
    if (body.marginBps !== undefined) {
      const margin = body.marginBps === null ? null : Number(body.marginBps);
      if (margin !== null && (!Number.isInteger(margin) || margin < 0 || margin > 9_900)) {
        throw new ApiError(400, "Margin must be between 0 and 9900 basis points.", "INVALID_MARGIN");
      }
      updates.margin_bps = margin;
    }
    if (body.fixedPriceMicros !== undefined) {
      const fixed = body.fixedPriceMicros === null ? null : Math.round(Number(body.fixedPriceMicros));
      if (fixed !== null && (!Number.isFinite(fixed) || fixed < 0)) {
        throw new ApiError(400, "Fixed price must be positive.", "INVALID_PRICE");
      }
      updates.fixed_price_micros = fixed;
    }
    if (body.minChargeMicros !== undefined) {
      updates.min_charge_micros = body.minChargeMicros === null ? null : Math.max(0, Math.round(Number(body.minChargeMicros)));
    }
    if (body.generationType !== undefined) {
      const value = body.generationType === null ? null : String(body.generationType);
      if (value && !(GENERATION_TYPES as readonly string[]).includes(value)) {
        throw new ApiError(400, "Unknown generation type.", "INVALID_GENERATION_TYPE");
      }
      updates.generation_type = value;
    }
    if (typeof body.isActive === "boolean") updates.is_active = body.isActive ? 1 : 0;
    if (Number.isInteger(body.priority)) updates.priority = Number(body.priority);
    const columns = Object.keys(updates);
    await db.run(
      `UPDATE pricing_overrides SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`,
      [...Object.values(updates), id] as Array<string | number | null>,
    );
    await auditRequest(db, request, actor, "admin.pricing_override_updated", "pricing_override", id, {
      fields: Object.keys(updates),
    });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const { db, actor } = await requireAdmin(request);
    await guardMutation(request, db, "admin-override-delete", 20, 60_000);
    const { id } = await params;
    const result = await db.run(`DELETE FROM pricing_overrides WHERE id = ?`, [id]);
    if (result.changes !== 1) throw new ApiError(404, "Pricing rule not found.", "OVERRIDE_NOT_FOUND");
    await auditRequest(db, request, actor, "admin.pricing_override_deleted", "pricing_override", id);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
