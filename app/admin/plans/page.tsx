import { Layers } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AdminPlans, type AdminPlan } from "@/components/admin-plans";
import { loadAdminFrame, shellUser } from "@/lib/server/frame";
import { listPlans, toPlanView } from "@/lib/server/plans";
import { listModelRows } from "@/lib/server/models";

export const dynamic = "force-dynamic";

export default async function AdminPlansPage() {
  const frame = await loadAdminFrame("/admin/plans");
  const [plans, links, models] = await Promise.all([
    listPlans(frame.db),
    frame.db.all<{ plan_id: string; model_id: string }>(`SELECT plan_id, model_id FROM plan_models`),
    listModelRows(frame.db),
  ]);
  const adminPlans: AdminPlan[] = plans.map((plan) => {
    const view = toPlanView(plan);
    return {
      id: view.id,
      code: view.code,
      name: view.name,
      description: view.description,
      priceCents: view.price_cents,
      creditsPerPeriod: view.credits_per_period,
      videoLimit: view.video_limit,
      imageLimit: view.image_limit,
      maxVideoDurationSeconds: view.max_video_duration_seconds,
      resolutions: view.resolutions,
      queuePriority: view.queue_priority,
      maxConcurrentJobs: view.max_concurrent_jobs,
      storageLimitMb: view.storage_limit_mb,
      premiumFeatures: view.premiumFeatures,
      isActive: view.is_active === 1,
      sortOrder: view.sort_order,
      modelIds: links.filter((link) => link.plan_id === view.id).map((link) => link.model_id),
    };
  });

  return (
    <AppShell
      active="admin-plans"
      user={shellUser(frame.actor)}
      availableCredits={frame.wallet.available}
      planName={frame.entitlements.plan?.name ?? null}
      variant="admin"
      title="Subscriptions"
    >
      <div className="page-head">
        <div>
          <div className="page-eyebrow">ADMIN · PLANS</div>
          <h1 className="page-title">Subscription plans</h1>
          <p className="page-sub">
            Price, credit allocation, generation limits, resolutions, concurrency, storage and model access. No code
            changes required.
          </p>
        </div>
        <div className="head-actions">
          <span className="badge badge-muted"><Layers size={12} /> {plans.length} plans</span>
        </div>
      </div>

      <AdminPlans
        plans={adminPlans}
        models={models.map((model) => ({ id: model.id, name: model.displayName, provider: model.providerName }))}
      />
    </AppShell>
  );
}
