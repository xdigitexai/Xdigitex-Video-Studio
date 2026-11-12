import { auditRequest, guardMutation, requireAdmin } from "@/lib/server/context";
import { getModelRow, normaliseCapabilities, setDefaultModel } from "@/lib/server/models";
import { ADAPTERS } from "@/lib/server/providers";
import { PRICING_UNITS, type PricingUnit } from "@/lib/server/pricing";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { clampInt, now, safeString } from "@/lib/server/util";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { db, actor } = await requireAdmin(request);
    await guardMutation(request, db, "admin-model-update", 60, 60_000);
    const { id } = await params;
    const model = await getModelRow(db, id);
    if (!model) throw new ApiError(404, "Model not found.", "MODEL_NOT_FOUND");
    const provider = await db.first<{ code: string }>(`SELECT code FROM ai_providers WHERE id = ?`, [model.provider_id]);
    const adapter = provider ? ADAPTERS[provider.code] : null;
    const body = await readJson<Record<string, unknown>>(request);
    const updates: Record<string, unknown> = { updated_at: now(), version: model.version + 1 };

    if (typeof body.displayName === "string") updates.display_name = safeString(body.displayName, 100) || model.display_name;
    if (typeof body.description === "string") updates.description = body.description.slice(0, 300);
    if (body.capabilities !== undefined) {
      const capabilities = normaliseCapabilities(body.capabilities);
      if (!capabilities.length) throw new ApiError(400, "Select at least one capability.", "INVALID_CAPABILITIES");
      if (adapter) {
        const unsupported = capabilities.filter((capability) => !adapter.capabilities.includes(capability));
        if (unsupported.length) {
          throw new ApiError(
            400,
            `The provider adapter does not implement: ${unsupported.join(", ")}.`,
            "CAPABILITY_NOT_IMPLEMENTED",
          );
        }
      }
      updates.capabilities = JSON.stringify(capabilities);
    }
    if (body.pricingUnit !== undefined) {
      if (!PRICING_UNITS.includes(body.pricingUnit as PricingUnit)) {
        throw new ApiError(400, "Invalid pricing unit.", "INVALID_PRICING_UNIT");
      }
      updates.pricing_unit = body.pricingUnit;
    }
    if (body.unitCostMicros !== undefined) {
      updates.unit_cost_micros = clampInt(body.unitCostMicros, 0, 1_000_000_000, model.unit_cost_micros);
    } else if (body.unitCostUsd !== undefined) {
      updates.unit_cost_micros = Math.max(0, Math.round(Number(body.unitCostUsd) * 1_000_000));
    }
    if (body.minChargeMicros !== undefined) {
      updates.min_charge_micros = clampInt(body.minChargeMicros, 0, 1_000_000_000, model.min_charge_micros);
    }
    if (body.pricingMeta && typeof body.pricingMeta === "object") {
      updates.pricing_meta = JSON.stringify(body.pricingMeta);
    }
    if (body.maxDurationSeconds !== undefined) {
      updates.max_duration_seconds = clampInt(body.maxDurationSeconds, 1, 300, model.max_duration_seconds);
    }
    if (Array.isArray(body.resolutions)) {
      updates.resolutions = JSON.stringify(body.resolutions.slice(0, 10).map(String));
    }
    if (typeof body.isActive === "boolean") updates.is_active = body.isActive ? 1 : 0;
    if (typeof body.isEstimated === "boolean") updates.is_estimated = body.isEstimated ? 1 : 0;
    if (body.sortOrder !== undefined) updates.sort_order = clampInt(body.sortOrder, 0, 1000, model.sort_order);

    const columns = Object.keys(updates);
    await db.run(
      `UPDATE ai_models SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`,
      [...Object.values(updates), id] as Array<string | number | null>,
    );
    if (updates.is_active === 0) {
      await db.run(`UPDATE ai_models SET is_default_video = 0, is_default_image = 0 WHERE id = ?`, [id]);
    }
    if (body.isDefaultVideo === true) await setDefaultModel(db, id, "video");
    if (body.isDefaultImage === true) await setDefaultModel(db, id, "image");
    await auditRequest(db, request, actor, "admin.model_updated", "model", id, {
      fields: Object.keys(updates),
      version: model.version + 1,
    });
    return json({ ok: true, version: model.version + 1 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const { db, actor } = await requireAdmin(request);
    await guardMutation(request, db, "admin-model-delete", 20, 60_000);
    const { id } = await params;
    const model = await getModelRow(db, id);
    if (!model) throw new ApiError(404, "Model not found.", "MODEL_NOT_FOUND");
    const used = await db.first<{ count: number }>(`SELECT COUNT(*) AS count FROM generations WHERE model_id = ?`, [id]);
    if ((used?.count ?? 0) > 0) {
      throw new ApiError(409, "This model has generation history. Deactivate it instead.", "MODEL_IN_USE");
    }
    await db.batch([
      { sql: `DELETE FROM plan_models WHERE model_id = ?`, params: [id] },
      { sql: `DELETE FROM ai_models WHERE id = ?`, params: [id] },
    ]);
    await auditRequest(db, request, actor, "admin.model_deleted", "model", id, { code: model.code });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
