import { auditRequest, guardMutation, requireAdmin } from "@/lib/server/context";
import { getPricingSettings, listPricingOverrides } from "@/lib/server/settings";
import { listPlans } from "@/lib/server/plans";
import { listModelRows, listProviders } from "@/lib/server/models";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { clampInt, now } from "@/lib/server/util";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { db } = await requireAdmin(request);
    const [settings, overrides, plans, providers, models, users] = await Promise.all([
      getPricingSettings(db),
      listPricingOverrides(db, false),
      listPlans(db),
      listProviders(db),
      listModelRows(db),
      db.all<{ id: string; email: string; display_name: string }>(
        `SELECT id, email, display_name FROM users ORDER BY created_at DESC LIMIT 500`,
      ),
    ]);
    return json({
      settings: {
        defaultMarginBps: settings.default_margin_bps,
        minChargeMicros: settings.min_charge_micros,
        creditValueMicros: settings.credit_value_micros,
        usdToKesRateMicros: settings.usd_to_kes_rate_micros,
        gracePeriodDays: settings.grace_period_days,
        currency: settings.currency,
        version: settings.version,
        updatedAt: settings.updated_at,
      },
      overrides,
      plans: plans.map((plan) => ({ id: plan.id, name: plan.name, code: plan.code })),
      providers: providers.map((provider) => ({ id: provider.id, name: provider.name, code: provider.code })),
      models: models.map((model) => ({ id: model.id, name: model.displayName, providerId: model.providerId })),
      users,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const { db, actor } = await requireAdmin(request);
    await guardMutation(request, db, "admin-pricing-update", 20, 60_000);
    const body = await readJson<Record<string, unknown>>(request);
    const current = await getPricingSettings(db);
    const defaultMarginBps = clampInt(body.defaultMarginBps, 0, 9_900, current.default_margin_bps);
    const minChargeMicros = clampInt(body.minChargeMicros, 0, 100_000_000, current.min_charge_micros);
    const creditValueMicros = clampInt(body.creditValueMicros, 1, 100_000_000, current.credit_value_micros);
    const usdToKesRateMicros = clampInt(body.usdToKesRateMicros, 1_000_000, 1_000_000_000, current.usd_to_kes_rate_micros);
    const gracePeriodDays = clampInt(body.gracePeriodDays, 0, 60, current.grace_period_days);
    if (defaultMarginBps >= 10_000) throw new ApiError(400, "Margin must be below 100%.", "INVALID_MARGIN");
    const version = current.version + 1;
    await db.run(
      `UPDATE pricing_settings SET default_margin_bps = ?, min_charge_micros = ?, credit_value_micros = ?,
         usd_to_kes_rate_micros = ?, grace_period_days = ?, version = ?, updated_at = ? WHERE id = 1`,
      [defaultMarginBps, minChargeMicros, creditValueMicros, usdToKesRateMicros, gracePeriodDays, version, now()],
    );
    await auditRequest(db, request, actor, "admin.pricing_updated", "pricing_settings", "1", {
      version,
      defaultMarginBps,
      creditValueMicros,
    });
    return json({ ok: true, version });
  } catch (error) {
    return errorResponse(error);
  }
}
