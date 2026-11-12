import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Wallet } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { UserAdminActions } from "@/components/admin-user-actions";
import { loadAdminFrame, shellUser } from "@/lib/server/frame";
import { customerDetail } from "@/lib/server/admin";
import { getEntitlements, listPlans, toPlanView } from "@/lib/server/plans";
import { isSuperAdminRole } from "@/lib/server/auth";
import { formatCredits, formatDate, formatDateTime, formatKes, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const frame = await loadAdminFrame(`/admin/users/${id}`);
  const [detail, entitlements, plans] = await Promise.all([
    customerDetail(frame.db, id),
    getEntitlements(frame.db, id),
    listPlans(frame.db, { activeOnly: true }),
  ]);
  if (!detail) notFound();

  return (
    <AppShell
      active="admin-users"
      user={shellUser(frame.actor)}
      availableCredits={frame.wallet.available}
      planName={frame.entitlements.plan?.name ?? null}
      variant="admin"
      title="Customer detail"
    >
      <div className="page-head">
        <div>
          <Link href="/admin/users" className="row tiny muted" style={{ gap: 5, marginBottom: 8 }}>
            <ArrowLeft size={12} /> All customers
          </Link>
          <h1 className="page-title">{detail.user.display_name || detail.user.email}</h1>
          <p className="page-sub">
            {detail.user.email} · joined {formatDate(detail.user.created_at)} ·{" "}
            {detail.user.email_verified_at ? "email verified" : "email unverified"}
          </p>
        </div>
        <div className="head-actions">
          <Link href={`/admin/pricing?userId=${detail.user.id}`} className="btn btn-secondary btn-sm">
            Individual pricing
          </Link>
        </div>
      </div>

      <div className="grid grid-4 mb-3">
        <div className="stat">
          <div className="stat-label"><Wallet size={13} /> Credits</div>
          <div className="stat-value">{formatCredits(detail.wallet?.balance ?? 0)}</div>
          <div className="stat-meta">{formatCredits(detail.wallet?.reserved ?? 0)} reserved</div>
        </div>
        <div className="stat">
          <div className="stat-label">Plan</div>
          <div className="stat-value" style={{ fontSize: 22 }}>{detail.subscription?.plan_name ?? "None"}</div>
          <div className="stat-meta">
            {detail.subscription
              ? `${detail.subscription.status} until ${formatDate(detail.subscription.current_period_end)}`
              : "No subscription"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Generation jobs</div>
          <div className="stat-value">{detail.usage?.jobs ?? 0}</div>
          <div className="stat-meta">{formatCredits(detail.usage?.credits ?? 0)} credits consumed</div>
        </div>
        <div className="stat">
          <div className="stat-label">Current entitlements</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{entitlements.status}</div>
          <div className="stat-meta">
            {entitlements.limits.maxVideoDurationSeconds}s max · {entitlements.limits.resolutions.join(", ") || "no resolutions"}
          </div>
        </div>
      </div>

      <div className="split">
        <div className="stack">
          <UserAdminActions
            userId={detail.user.id}
            role={detail.user.role}
            status={detail.user.status}
            canManageRoles={isSuperAdminRole(frame.actor.user.role)}
            plans={plans.map(toPlanView).map((plan) => ({ id: plan.id, name: plan.name, priceUsd: plan.priceUsd, credits: plan.credits_per_period }))}
          />
        </div>

        <aside className="stack">
          <div className="card">
            <div className="card-head"><h3>Recent payments</h3></div>
            <div className="card-body" style={{ paddingTop: 8 }}>
              {detail.payments.length ? detail.payments.map((payment) => (
                <div className="history-row" key={payment.id}>
                  <span className="history-main">
                    <b className="truncate">{payment.purpose.replace(/_/g, " ")}</b>
                    <span>{formatDateTime(payment.created_at)} · {payment.credits} credits</span>
                  </span>
                  <span className="history-amount">
                    <div>{formatKes(payment.amount_minor / 100)}</div>
                    <div className="tiny muted">{payment.status}</div>
                  </span>
                </div>
              )) : <p className="muted small">No payments.</p>}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3>Credit ledger</h3></div>
            <div className="card-body" style={{ paddingTop: 8 }}>
              {detail.ledger.length ? detail.ledger.map((entry) => (
                <div className="history-row" key={entry.id}>
                  <span className="history-main">
                    <b className="truncate">{entry.description || entry.kind}</b>
                    <span>{formatDateTime(entry.created_at)}</span>
                  </span>
                  <span className="history-amount" style={{ color: entry.amount > 0 ? "var(--lime)" : "var(--soft)" }}>
                    {entry.amount > 0 ? "+" : ""}{entry.amount}
                    <div className="tiny muted">{entry.balance_after} bal.</div>
                  </span>
                </div>
              )) : <p className="muted small">No ledger entries.</p>}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3>Pricing overrides</h3></div>
            <div className="card-body stack">
              {detail.overrides.length ? detail.overrides.map((override) => (
                <div className="row-between" key={override.id}>
                  <span className="small">{override.label || "Customer rule"}</span>
                  <span className="badge badge-lime">
                    {override.margin_bps !== null ? `${(override.margin_bps / 100).toFixed(1)}% margin` : `Fixed ${formatMoney(override.fixed_price_micros ?? 0)}`}
                  </span>
                </div>
              )) : <p className="muted small">No individual pricing. Global defaults apply.</p>}
            </div>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
