import Link from "next/link";
import { Receipt, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PaymentActions, SweepButton } from "@/components/admin-payment-actions";
import { loadAdminFrame, shellUser } from "@/lib/server/frame";
import { filtersFromSearchParams, resolveSearchParams } from "@/lib/server/admin";
import { listPayments, paymentView, PAYMENT_STATUS_LABEL } from "@/lib/server/payments/service";
import { normalizeEmail } from "@/lib/server/util";
import { formatDateTime, formatKes, formatUsdCents } from "@/lib/format";

export const dynamic = "force-dynamic";

function statusBadge(status: string) {
  if (status === "completed") return <span className="badge badge-ok">Paid</span>;
  if (status === "pending") return <span className="badge badge-warn">Pending</span>;
  if (status === "failed") return <span className="badge badge-danger">Failed</span>;
  if (status === "cancelled") return <span className="badge badge-muted">Cancelled</span>;
  if (status === "refunded") return <span className="badge badge-violet">Refunded</span>;
  return <span className="badge badge-muted">{PAYMENT_STATUS_LABEL[status] ?? status}</span>;
}

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, unknown>> | Record<string, unknown>;
}) {
  const frame = await loadAdminFrame("/admin/payments");
  const { db } = frame;
  const params = await resolveSearchParams(searchParams);
  const filters = filtersFromSearchParams(params);
  const email = params.get("email")?.trim();
  if (email) {
    const user = await db.first<{ id: string }>(`SELECT id FROM users WHERE email_normalized = ?`, [
      normalizeEmail(email),
    ]);
    filters.userId = user?.id ?? "none";
  }
  const status = params.get("status") || "";
  const payments = await listPayments(db, {
    userId: filters.userId,
    status: status || undefined,
    since: filters.since,
    until: filters.until,
    limit: 100,
  });
  const users = await Promise.all(
    payments.map((payment) =>
      db.first<{ email: string }>(`SELECT email FROM users WHERE id = ?`, [payment.user_id]),
    ),
  );

  return (
    <AppShell
      active="admin-payments"
      user={shellUser(frame.actor)}
      availableCredits={frame.wallet.available}
      planName={frame.entitlements.plan?.name ?? null}
      variant="admin"
      title="Payments"
    >
      <div className="page-head">
        <div>
          <div className="page-eyebrow">ADMIN · MONEY IN</div>
          <h1 className="page-title">Payments &amp; reconciliation</h1>
          <p className="page-sub">
            Verify gateway results, recover incomplete fulfilment and record refunds. A browser redirect is never
            treated as proof of payment.
          </p>
        </div>
        <div className="head-actions">
          <SweepButton />
        </div>
      </div>

      <form className="admin-filter" method="get" action="/admin/payments">
        <div className="field">
          <label className="label" htmlFor="status">Status</label>
          <select className="select" id="status" name="status" defaultValue={status}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
            <option value="refunded">Refunded</option>
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="email">Customer email</label>
          <input className="input" id="email" name="email" defaultValue={params.get("email") ?? ""} placeholder="exact email" />
        </div>
        <div className="field">
          <label className="label" htmlFor="since">From</label>
          <input className="input" id="since" name="since" type="date" defaultValue={params.get("since") ?? ""} />
        </div>
        <div className="field">
          <label className="label" htmlFor="until">To</label>
          <input className="input" id="until" name="until" type="date" defaultValue={params.get("until") ?? ""} />
        </div>
        <button className="btn btn-primary btn-sm" type="submit">Apply</button>
        <Link className="btn btn-ghost btn-sm" href="/admin/payments">Reset</Link>
      </form>

      <div className="table-wrap">
        <table className="data" style={{ minWidth: 980 }}>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Customer</th>
              <th>Purpose</th>
              <th className="num">Amount</th>
              <th className="num">Credits</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((payment, index) => {
              const view = paymentView(payment);
              return (
                <tr key={payment.id}>
                  <td>
                    <span className="mono strong">{payment.reference}</span>
                    {payment.provider_checkout_id ? (
                      <div className="tiny muted truncate" style={{ maxWidth: 200 }} title={payment.provider_checkout_id}>
                        {payment.provider_checkout_id}
                      </div>
                    ) : null}
                    {payment.fulfillment_error ? (
                      <div className="tiny" style={{ color: "var(--danger)" }}>fulfilment: {payment.fulfillment_error}</div>
                    ) : null}
                  </td>
                  <td className="tiny">{users[index]?.email ?? payment.user_id}</td>
                  <td className="tiny">{payment.purpose.replace(/_/g, " ")}</td>
                  <td className="num">
                    {formatKes(view.amountKes)}
                    <div className="tiny muted">{formatUsdCents(Math.round(view.priceUsd * 100))}</div>
                  </td>
                  <td className="num">{payment.credits}</td>
                  <td>
                    {statusBadge(payment.status)}
                    {payment.provider_receipt ? <div className="tiny muted mono">{payment.provider_receipt}</div> : null}
                  </td>
                  <td className="tiny">{formatDateTime(payment.created_at)}</td>
                  <td>
                    <PaymentActions
                      paymentId={payment.id}
                      status={payment.status}
                      canReconcile={Boolean(payment.provider_checkout_id) && payment.status !== "completed" && payment.status !== "refunded"}
                      hasReceipt={Boolean(payment.provider_receipt)}
                    />
                  </td>
                </tr>
              );
            })}
            {!payments.length ? (
              <tr>
                <td colSpan={8}>
                  <div className="empty" style={{ border: 0 }}>
                    <div className="empty-icon"><Receipt size={20} /></div>
                    <strong>No payments in this range</strong>
                    <p>Checkouts and top-ups will appear here after they are created.</p>
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="tiny muted mt-2">
        <TriangleAlert size={12} /> Refunds are recorded locally; the gateway&apos;s documented API does not expose a
        refund endpoint, so complete any provider-side reversal in the Pay Xdigitex dashboard as well.
      </p>
    </AppShell>
  );
}
