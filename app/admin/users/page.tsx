import Link from "next/link";
import { UserCog, Users } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { loadAdminFrame, shellUser } from "@/lib/server/frame";
import { listCustomers } from "@/lib/server/admin";
import { formatCredits, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, unknown>> | Record<string, unknown>;
}) {
  const frame = await loadAdminFrame("/admin/users");
  const raw = await Promise.resolve(searchParams ?? {});
  const search = typeof raw.search === "string" ? raw.search : "";
  const customers = await listCustomers(frame.db, { search: search || undefined, limit: 200 });

  return (
    <AppShell
      active="admin-users"
      user={shellUser(frame.actor)}
      availableCredits={frame.wallet.available}
      planName={frame.entitlements.plan?.name ?? null}
      variant="admin"
      title="Customers"
    >
      <div className="page-head">
        <div>
          <div className="page-eyebrow">ADMIN · ACCOUNTS</div>
          <h1 className="page-title">Customers</h1>
          <p className="page-sub">Manage roles, account status, credits, plans and individual pricing.</p>
        </div>
      </div>

      <form className="admin-filter" method="get" action="/admin/users">
        <div className="field" style={{ maxWidth: 420 }}>
          <label className="label" htmlFor="search">Search name or email</label>
          <input className="input" id="search" name="search" defaultValue={search} placeholder="alex@studio.com" />
        </div>
        <button className="btn btn-primary btn-sm" type="submit">Search</button>
        <Link className="btn btn-ghost btn-sm" href="/admin/users">Reset</Link>
      </form>

      <div className="table-wrap">
        <table className="data" style={{ minWidth: 900 }}>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Role</th>
              <th>Plan</th>
              <th>Status</th>
              <th className="num">Credits</th>
              <th className="num">Jobs</th>
              <th className="num">Joined</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id}>
                <td>
                  <Link href={`/admin/users/${customer.id}`} className="strong">{customer.display_name || "Unnamed"}</Link>
                  <div className="tiny muted">{customer.email}</div>
                </td>
                <td>
                  <span className={`badge ${customer.role === "customer" ? "badge-muted" : "badge-violet"}`}>
                    {customer.role.replace("_", " ")}
                  </span>
                </td>
                <td className="tiny">
                  {customer.plan_name ?? "—"}
                  {customer.period_end ? <div className="tiny muted">until {formatDate(customer.period_end)}</div> : null}
                </td>
                <td>
                  <span className={`badge ${customer.status === "active" ? "badge-ok" : "badge-danger"}`}>
                    {customer.status}
                  </span>
                  {customer.subscription_status && customer.subscription_status !== "active" ? (
                    <div className="tiny muted">{customer.subscription_status.replace("_", " ")}</div>
                  ) : null}
                </td>
                <td className="num">
                  {formatCredits(customer.balance)}
                  {customer.reserved ? <div className="tiny muted">{formatCredits(customer.reserved)} held</div> : null}
                </td>
                <td className="num">{customer.generations}</td>
                <td className="num tiny">{formatDate(customer.created_at)}</td>
                <td>
                  <Link href={`/admin/users/${customer.id}`} className="btn btn-secondary btn-sm">
                    <UserCog size={13} /> Manage
                  </Link>
                </td>
              </tr>
            ))}
            {!customers.length ? (
              <tr>
                <td colSpan={8}>
                  <div className="empty" style={{ border: 0 }}>
                    <div className="empty-icon"><Users size={20} /></div>
                    <strong>No customers found</strong>
                    <p>Try a different search, or invite customers through the public registration page.</p>
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
