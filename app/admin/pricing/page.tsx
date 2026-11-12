import { AppShell } from "@/components/app-shell";
import { AdminPricing } from "@/components/admin-pricing";
import { loadAdminFrame, shellUser } from "@/lib/server/frame";
import { getPricingSettings, listPricingOverrides } from "@/lib/server/settings";
import { listPlans } from "@/lib/server/plans";
import { listModelRows, listProviders } from "@/lib/server/models";

export const dynamic = "force-dynamic";

export default async function AdminPricingPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, unknown>> | Record<string, unknown>;
}) {
  const frame = await loadAdminFrame("/admin/pricing");
  const raw = await Promise.resolve(searchParams ?? {});
  const preselectedUserId = typeof raw.userId === "string" ? raw.userId : undefined;
  const [settings, overrides, users, plans, providers, models] = await Promise.all([
    getPricingSettings(frame.db),
    listPricingOverrides(frame.db, false),
    frame.db.all<{ id: string; email: string; display_name: string }>(
      `SELECT id, email, display_name FROM users ORDER BY created_at DESC LIMIT 1000`,
    ),
    listPlans(frame.db),
    listProviders(frame.db),
    listModelRows(frame.db),
  ]);

  return (
    <AppShell
      active="admin-pricing"
      user={shellUser(frame.actor)}
      availableCredits={frame.wallet.available}
      planName={frame.entitlements.plan?.name ?? null}
      variant="admin"
      title="Margins & pricing"
    >
      <div className="page-head">
        <div>
          <div className="page-eyebrow">ADMIN · PROFIT ENGINE</div>
          <h1 className="page-title">Margins &amp; pricing</h1>
          <p className="page-sub">
            Configure global and per-customer gross margins. Every generation stores a pricing snapshot so historic
            charges never change.
          </p>
        </div>
      </div>

      <AdminPricing
        settings={{
          defaultMarginBps: settings.default_margin_bps,
          minChargeMicros: settings.min_charge_micros,
          creditValueMicros: settings.credit_value_micros,
          usdToKesRateMicros: settings.usd_to_kes_rate_micros,
          gracePeriodDays: settings.grace_period_days,
          version: settings.version,
        }}
        overrides={overrides.map((override) => ({
          id: override.id,
          label: override.label,
          user_id: override.user_id,
          plan_id: override.plan_id,
          provider_id: override.provider_id,
          model_id: override.model_id,
          generation_type: override.generation_type,
          margin_bps: override.margin_bps,
          fixed_price_micros: override.fixed_price_micros,
          min_charge_micros: override.min_charge_micros,
          priority: override.priority,
          is_active: override.is_active,
        }))}
        users={users.map((user) => ({ id: user.id, name: `${user.display_name || user.email} · ${user.email}` }))}
        plans={plans.map((plan) => ({ id: plan.id, name: plan.name, code: plan.code }))}
        providers={providers.map((provider) => ({ id: provider.id, name: provider.name, code: provider.code }))}
        models={models.map((model) => ({ id: model.id, name: `${model.displayName} · ${model.providerName}`, providerId: model.providerId }))}
        preselectedUserId={preselectedUserId}
      />
    </AppShell>
  );
}
