import { auditRequest, guardMutation, requireAdmin } from "@/lib/server/context";
import { listPricingOverrides } from "@/lib/server/settings";
import { GENERATION_TYPES } from "@/lib/server/pricing";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { newId, now, safeString } from "@/lib/server/util";

export const dynamic = "force-dynamic";

function validateScope(body: Record<string, unknown>, db: Awaited<ReturnType<typeof requireAdmin>>["db"]) {
  const marginRaw = body.marginBps;
  const fixedRaw = body.fixedPriceMicros;
  const marginBps = marginRaw === null || marginRaw === undefined ? null : Number(marginRaw);
  const fixedPriceMicros = fixedRaw === null || fixedRaw === undefined ? null : Number(fixedRaw);
  if (marginBps !== null && (!Number.isInteger(marginBps) || marginBps < 0 || marginBps > 9_900)) {
    throw new ApiError(400, "Margin must be an integer between 0 and 9900 basis points.", "INVALID_MARGIN");
  }
  if (fixedPriceMicros !== null && (!Number.isFinite(fixedPriceMicros) || fixedPriceMicros < 0)) {
    throw new ApiError(400, "Fixed price must be a positive amount.", "INVALID_PRICE");
  }
  if (marginBps === null && fixedPriceMicros === null) {
    throw new ApiError(400, "Set a margin or a fixed selling price.", "INVALID_RULE");
  }
  const generationType = body.generationType ? safeString(body.generationType, 40) : null;
  if (generationType && !(GENERATION_TYPES as readonly string[]).includes(generationType)) {
    throw new ApiError(400, "Unknown generation type.", "INVALID_GENERATION_TYPE");
  }
  void db;
  return {
    userId: body.userId ? safeString(body.userId, 80) : null,
    planId: body.planId ? safeString(body.planId, 80) : null,
    providerId: body.providerId ? safeString(body.providerId, 80) : null,
    modelId: body.modelId ? safeString(body.modelId, 80) : null,
    generationType,
    marginBps,
    fixedPriceMicros,
    minChargeMicros:
      body.minChargeMicros === undefined || body.minChargeMicros === null
        ? null
        : Math.max(0, Math.round(Number(body.minChargeMicros))),
  };
}

export async function GET(request: Request) {
  try {
    const { db } = await requireAdmin(request);
    return json({ overrides: await listPricingOverrides(db, false) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, actor } = await requireAdmin(request);
    await guardMutation(request, db, "admin-override-create", 40, 60_000);
    const body = await readJson<Record<string, unknown>>(request);
    const scope = validateScope(body, db);
    const id = newId("prc_o");
    await db.run(
      `INSERT INTO pricing_overrides (id, label, user_id, plan_id, provider_id, model_id, generation_type,
         margin_bps, fixed_price_micros, min_charge_micros, priority, is_active, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
      [
        id,
        safeString(body.label, 100),
        scope.userId,
        scope.planId,
        scope.providerId,
        scope.modelId,
        scope.generationType,
        scope.marginBps,
        scope.fixedPriceMicros,
        scope.minChargeMicros,
        Number.isInteger(body.priority) ? Number(body.priority) : 0,
        now(),
        now(),
      ],
    );
    await auditRequest(db, request, actor, "admin.pricing_override_created", "pricing_override", id, scope);
    return json({ ok: true, id }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
