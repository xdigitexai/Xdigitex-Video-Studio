import { CreditCard, Receipt, Wallet } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { BillingActions, type PackLite, type PlanLite } from "@/components/billing-actions";
import { loadFrame, shellUser } from "@/lib/server/frame";
import { listPlans, toPlanView, latestSubscription, refreshSubscription } from "@/lib/server/plans";
import { listPayments, paymentView, PAYMENT_STATUS_LABEL } from "@/lib/server/payments/service";
import { getPricingSettings } from "@/lib/server/settings";
import { listLedger } from "@/lib/server/credits";
import { formatCredits, formatDate, formatKes, formatUsdCents, relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

function statusBadge(status: string) {
  if (status === "completed") return <span className="badge badge-ok">Paid</span>;
  if (status === "pending") return <span className="badge badge-warn">Awaiting payment</span>;
  if (status === "failed") return <span className="badge badge-danger">Failed</span>;
  if (status === "cancelled") return <span className="badge badge-muted">Cancelled</span>;
  if (status === "refunded") return <span className="badge badge-violet">Refunded</span>;
  return <span className="badge badge-muted">{PAYMENT_STATUS_LABEL[status] ?? status}</span>;
}

export default async function BillingPage() {
  const frame = await loadFrame("/billing");
  const { db, env, actor, wallet, entitlements } = frame;
  const settings = await getPricingSettings(db);
  let subscription = await latestSubscription(db, actor.user.id);
  if (subscription) subscription = await refreshSubscription(db, subscription, settings.grace_period_days);

  const [plans, packages, payments, ledger] = await Promise.all([
    listPlans(db, { activeOnly: true }),
    db.all<{ id: string; name: string; credits: number; bonus_credits: number; price_cents: number }>(
      `SELECT id, name, credits, bonus_credits, price_cents FROM credit_packages WHERE is_active = 1 ORDER BY sort_order ASC`,
    ),
    listPayments(db, { userId: actor.user.id, limit: 30 }),
    listLedger(db, actor.user.id, 12),
  ]);
  const planLites: PlanLite[] = plans.map((plan) => {
    const view = toPlanView(plan);
    return {
      id: view.id,
      code: view.code,
      name: view.name,
      description: view.description,
      priceUsd: view.priceUsd,
      credits: view.credits_per_period,
      videoLimit: view.video_limit,
      imageLimit: view.image_limit,
      maxDuration: view.max_video_duration_seconds,
      resolutions: view.resolutions,
      features: [...view.premiumFeatures, `${view.max_concurrent_jobs} concurrent job${view.max_concurrent_jobs === 1 ? "" : "s"}`, `${(view.storage_limit_mb / 1024).toFixed(0)} GB storage`],
    };
  });
  const packLites: PackLite[] = packages.map((pack) => ({
    id: pack.id,
    name: pack.name,
    credits: pack.credits,
    bonus: pack.bonus_credits,
    priceUsd: pack.price_cents / 100,
  }));
  const gatewayConfigured = Boolean(env.XDIGITEX_PAY_API_KEY);
  const webhookConfigured = Boolean(env.XDIGITEX_WEBHOOK_SECRET);
  const renewalDue = subscription?.status === "past_due";

  return (
    <AppShell
      active="billing"
      user={shellUser(actor)}
      availableCredits={wallet.available}
      planName={entitlements.plan?.name ?? null}
      title="Billing & credits"
    >
      <div className="page-head">
        <div>
          <div className="page-eyebrow">BILLING</div>
          <h1 className="page-title">Billing &amp; credits</h1>
          <p className="page-sub">
            Manage your plan, top up credits and review every payment. Charges are processed by Pay Xdigitex
            (M-Pesa) and activated only after server-side verification.
          </p>
        </div>
      </div>

      <div className="grid grid-4 mb-3">
        <div className="stat">
          <div className="stat-label"><Wallet size={13} /> Available</div>
          <div className="stat-value stat-accent">{formatCredits(wallet.available)}</div>
          <div className="stat-meta">{formatCredits(wallet.reserved)} reserved</div>
        </div>
        <div className="stat">
          <div className="stat-label"><CreditCard size={13} /> Plan</div>
          <div className="stat-value">{entitlements.plan?.name ?? "None"}</div>
          <div className="stat-meta">
            {subscription
              ? `Period ends ${formatDate(subscription.current_period_end)}`
              : "No active subscription"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Purchased credits</div>
          <div className="stat-value">{formatCredits(wallet.lifetimePurchased)}</div>
          <div className="stat-meta">Never expire</div>
        </div>
        <div className="stat">
          <div className="stat-label">Consumed credits</div>
          <div className="stat-value">{formatCredits(wallet.lifetimeConsumed)}</div>
          <div className="stat-meta">All time</div>
        </div>
      </div>

      {!webhookConfigured ? (
        <div className="notice notice-warn mb-3">
          <Receipt size={16} />
          <span>
            The payment webhook secret is not configured. Payments will still be verified by polling, but webhook
            confirmation should be configured before going live.
          </span>
        </div>
      ) : null}

      <div className="split">
        <BillingActions
          plans={planLites}
          packages={packLites}
          currentPlanId={entitlements.plan?.id ?? null}
          subscription={
            subscription
              ? {
                  status: subscription.status,
                  cancelAtPeriodEnd: subscription.cancel_at_period_end === 1,
                  periodEnd: subscription.current_period_end,
                  pendingPlanId: subscription.pending_plan_id,
                }
              : null
          }
          gatewayConfigured={gatewayConfigured}
          usdToKesRate={settings.usd_to_kes_rate_micros / 1_000_000}
          renewalDue={renewalDue}
        />

        <aside className="stack">
          <div className="card">
            <div className="card-head">
              <h3>Payment history</h3>
              <span className="tiny muted">{payments.length} records</span>
            </div>
            <div className="card-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
              {payments.length ? (
                payments.map((payment) => {
                  const view = paymentView(payment);
                  return (
                    <div className="history-row" key={view.id}>
                      <span className="icon-box"><Receipt size={14} /></span>
                      <span className="history-main">
                        <b className="truncate">
                          {view.purpose === "credit_topup"
                            ? "Credit top-up"
                            : view.purpose === "subscription_renewal"
                              ? "Plan renewal"
                              : view.purpose === "plan_change"
                                ? "Plan change"
                                : "Subscription"}
                        </b>
                        <span title={view.reference}>
                          {formatDate(view.createdAt)} · {view.credits} credits
                        </span>
                      </span>
                      <span className="history-amount">
                        <div>{formatKes(view.amountKes)}</div>
                        <div className="tiny muted">{formatUsdCents(Math.round(view.priceUsd * 100))}</div>
                        <div className="mt-1">{statusBadge(view.status)}</div>
                      </span>
                    </div>
                  );
                })
              ) : (
                <p className="muted small" style={{ padding: "12px 0" }}>
                  No payments yet. Your receipts will appear here after the first purchase.
                </p>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Recent credits</h3>
            </div>
            <div className="card-body" style={{ paddingTop: 8 }}>
              {ledger.length ? (
                ledger.map((entry) => (
                  <div className="history-row" key={entry.id}>
                    <span className="icon-box"><Wallet size={14} /></span>
                    <span className="history-main">
                      <b className="truncate">{entry.description || entry.kind}</b>
                      <span>{relativeTime(entry.created_at)}</span>
                    </span>
                    <span className="history-amount" style={{ color: entry.amount > 0 ? "var(--lime)" : "var(--soft)" }}>
                      {entry.amount > 0 ? "+" : ""}{formatCredits(entry.amount)}
                    </span>
                  </div>
                ))
              ) : (
                <p className="muted small">No credit activity yet.</p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
