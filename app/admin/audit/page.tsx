import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { loadAdminFrame, shellUser } from "@/lib/server/frame";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, unknown>> | Record<string, unknown>;
}) {
  const frame = await loadAdminFrame("/admin/audit");
  const raw = await Promise.resolve(searchParams ?? {});
  const action = typeof raw.action === "string" ? raw.action : "";
  const rows = await frame.db.all<{
    id: string;
    actor_email: string | null;
    action: string;
    target_type: string;
    target_id: string;
    ip: string | null;
    metadata: string;
    created_at: number;
  }>(
    `SELECT * FROM audit_logs ${action ? "WHERE action LIKE ?" : ""} ORDER BY created_at DESC LIMIT 200`,
    action ? [`${action}%`] : [],
  );

  return (
    <AppShell
      active="admin-audit"
      user={shellUser(frame.actor)}
      availableCredits={frame.wallet.available}
      planName={frame.entitlements.plan?.name ?? null}
      variant="admin"
      title="Audit log"
    >
      <div className="page-head">
        <div>
          <div className="page-eyebrow">ADMIN · SECURITY</div>
          <h1 className="page-title">Audit log</h1>
          <p className="page-sub">Append-only record of authentication, billing, generation and administrative actions.</p>
        </div>
      </div>

      <form className="admin-filter" method="get" action="/admin/audit">
        <div className="field">
          <label className="label" htmlFor="action">Action prefix</label>
          <input className="input" id="action" name="action" placeholder="e.g. admin., payment., auth." defaultValue={action} />
        </div>
        <button className="btn btn-primary btn-sm" type="submit">Filter</button>
        <Link className="btn btn-ghost btn-sm" href="/admin/audit">Reset</Link>
      </form>

      <div className="table-wrap">
        <table className="data" style={{ minWidth: 860 }}>
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th>IP</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="tiny nowrap">{formatDateTime(row.created_at)}</td>
                <td className="tiny">{row.actor_email ?? "system"}</td>
                <td><span className="badge badge-muted">{row.action}</span></td>
                <td className="tiny mono">
                  {row.target_type}
                  {row.target_id ? ` · ${row.target_id.slice(0, 16)}` : ""}
                </td>
                <td className="tiny muted">{row.ip ?? "—"}</td>
                <td className="tiny muted truncate" style={{ maxWidth: 260 }} title={row.metadata}>
                  {row.metadata}
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={6}>
                  <div className="empty" style={{ border: 0 }}>
                    <div className="empty-icon"><ShieldCheck size={20} /></div>
                    <strong>No audit entries</strong>
                    <p>Actions will be recorded as administrators and customers use the platform.</p>
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
