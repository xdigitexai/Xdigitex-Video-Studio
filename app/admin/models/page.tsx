import { AppShell } from "@/components/app-shell";
import { AdminModels, type AdminModel } from "@/components/admin-models";
import { loadAdminFrame, shellUser } from "@/lib/server/frame";
import { listModelRows, listProviders } from "@/lib/server/models";
import { ADAPTERS } from "@/lib/server/providers";

export const dynamic = "force-dynamic";

export default async function AdminModelsPage() {
  const frame = await loadAdminFrame("/admin/models");
  const [models, providers] = await Promise.all([listModelRows(frame.db), listProviders(frame.db)]);
  const adminModels: AdminModel[] = models.map((model) => ({
    id: model.id,
    providerId: model.providerId,
    providerName: model.providerName,
    providerCode: model.providerCode,
    code: model.code,
    displayName: model.displayName,
    description: model.description,
    capabilities: model.capabilities,
    pricingUnit: model.pricingUnit,
    unitCostMicros: model.unitCostMicros,
    minChargeMicros: model.minChargeMicros,
    maxDurationSeconds: model.maxDurationSeconds,
    resolutions: model.resolutions,
    isActive: model.isActive,
    isEstimated: model.isEstimated,
    isDefaultVideo: model.isDefaultVideo,
    isDefaultImage: model.isDefaultImage,
    sortOrder: model.sortOrder,
  }));

  return (
    <AppShell
      active="admin-models"
      user={shellUser(frame.actor)}
      availableCredits={frame.wallet.available}
      planName={frame.entitlements.plan?.name ?? null}
      variant="admin"
      title="Models & pricing"
    >
      <div className="page-head">
        <div>
          <div className="page-eyebrow">ADMIN · MODELS</div>
          <h1 className="page-title">Models &amp; provider costs</h1>
          <p className="page-sub">
            Activate models, declare their real capabilities, set provider unit costs and switch defaults without a
            deployment.
          </p>
        </div>
      </div>
      <AdminModels
        models={adminModels}
        providers={providers.map((provider) => ({
          id: provider.id,
          code: provider.code,
          name: provider.name,
          isEnabled: provider.is_enabled === 1,
          capabilities: ADAPTERS[provider.code]?.capabilities ?? [],
        }))}
      />
    </AppShell>
  );
}
