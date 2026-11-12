import { auditRequest, guardMutation, requireAdmin } from "@/lib/server/context";
import { listModelRows, listProviders, normaliseCapabilities, setDefaultModel } from "@/lib/server/models";
import { ADAPTERS } from "@/lib/server/providers";
import { PRICING_UNITS, type PricingUnit } from "@/lib/server/pricing";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { clampInt, newId, now, safeString } from "@/lib/server/util";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { db } = await requireAdmin(request);
    const [models, providers] = await Promise.all([listModelRows(db), listProviders(db)]);
    return json({
      models,
      providers: providers.map((provider) => ({
        id: provider.id,
        code: provider.code,
        name: provider.name,
        isEnabled: provider.is_enabled === 1,
        capabilities: ADAPTERS[provider.code]?.capabilities ?? [],
        status: provider.status,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, actor } = await requireAdmin(request);
    await guardMutation(request, db, "admin-model-create", 30, 60_000);
    const body = await readJson<Record<string, unknown>>(request);
    const providerId = safeString(body.providerId, 80);
    const provider = await db.first<{ id: string; code: string }>(
      `SELECT id, code FROM ai_providers WHERE id = ? LIMIT 1`,
      [providerId],
    );
    if (!provider) throw new ApiError(404, "Provider not found.", "PROVIDER_NOT_FOUND");
    const adapter = ADAPTERS[provider.code];
    if (!adapter) throw new ApiError(400, "No adapter for this provider.", "ADAPTER_MISSING");
    const code = safeString(body.code, 120);
    if (!code) throw new ApiError(400, "Model code is required.", "INVALID_MODEL");
    const capabilities = normaliseCapabilities(body.capabilities);
    if (!capabilities.length) throw new ApiError(400, "Select at least one capability.", "INVALID_CAPABILITIES");
    const unsupported = capabilities.filter((capability) => !adapter.capabilities.includes(capability));
    if (unsupported.length) {
      throw new ApiError(
        400,
        `The ${provider.code} adapter does not implement: ${unsupported.join(", ")}.`,
        "CAPABILITY_NOT_IMPLEMENTED",
      );
    }
    const pricingUnit = PRICING_UNITS.includes(body.pricingUnit as PricingUnit)
      ? (body.pricingUnit as PricingUnit)
      : "per_request";
    const unitCostMicros =
      body.unitCostMicros !== undefined
        ? clampInt(body.unitCostMicros, 0, 1_000_000_000, 0)
        : Math.round(Number(body.unitCostUsd ?? 0) * 1_000_000);
    const timestamp = now();
    const id = newId("mdl");
    try {
      await db.run(
        `INSERT INTO ai_models (id, provider_id, code, display_name, description, capabilities, pricing_unit,
           unit_cost_micros, min_charge_micros, pricing_meta, max_duration_seconds, resolutions, is_active,
           is_default_video, is_default_image, is_estimated, sort_order, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 1, ?, ?)`,
        [
          id,
          provider.id,
          code,
          safeString(body.displayName, 100) || code,
          safeString(body.description, 300),
          JSON.stringify(capabilities),
          pricingUnit,
          unitCostMicros,
          clampInt(body.minChargeMicros, 0, 1_000_000_000, 0),
          JSON.stringify(body.pricingMeta && typeof body.pricingMeta === "object" ? body.pricingMeta : {}),
          clampInt(body.maxDurationSeconds, 1, 300, 10),
          JSON.stringify(Array.isArray(body.resolutions) ? body.resolutions.slice(0, 10).map(String) : []),
          body.isActive === false ? 0 : 1,
          body.isEstimated === false ? 0 : 1,
          clampInt(body.sortOrder, 0, 1000, 100),
          timestamp,
          timestamp,
        ],
      );
    } catch (error) {
      if (String(error).includes("UNIQUE")) {
        throw new ApiError(409, "This model code already exists for that provider.", "MODEL_EXISTS");
      }
      throw error;
    }
    if (body.isDefaultVideo === true) await setDefaultModel(db, id, "video");
    if (body.isDefaultImage === true) await setDefaultModel(db, id, "image");
    await auditRequest(db, request, actor, "admin.model_created", "model", id, {
      providerId: provider.id,
      capabilities,
    });
    return json({ ok: true, id }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
