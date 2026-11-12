import Link from "next/link";
import { CheckCircle2, Clock, Film, Image as ImageIcon, LoaderCircle, Wallet } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { loadFrame, shellUser } from "@/lib/server/frame";
import { generationView, listGenerations } from "@/lib/server/generation";
import { listLedger } from "@/lib/server/credits";
import { formatCredits, formatDateTime, relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

function statusBadge(status: string) {
  if (status === "SUCCEEDED") return <span className="badge badge-ok"><CheckCircle2 size={11} /> Completed</span>;
  if (status === "FAILED") return <span className="badge badge-danger">Failed</span>;
  if (status === "CANCELED") return <span className="badge badge-muted">Cancelled</span>;
  return <span className="badge badge-warn"><LoaderCircle size={11} className="spin" /> {status === "QUEUED" ? "Queued" : "Processing"}</span>;
}

export default async function UsagePage() {
  const frame = await loadFrame("/usage");
  const { db, actor, entitlements, wallet } = frame;
  const [rows, ledger, totals] = await Promise.all([
    listGenerations(db, { userId: actor.user.id, limit: 60 }),
    listLedger(db, actor.user.id, 20),
    db.first<{ jobs: number; credits: number; videos: number; images: number; failed: number }>(
      `SELECT COUNT(*) AS jobs, COALESCE(SUM(credits_charged), 0) AS credits,
         SUM(CASE WHEN capability IN ('text_to_video','image_to_video','video_to_video') THEN 1 ELSE 0 END) AS videos,
         SUM(CASE WHEN capability IN ('text_to_image','image_edit','image_variations') THEN 1 ELSE 0 END) AS images,
         SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed
       FROM generations WHERE owner_id = ?`,
      [actor.user.id],
    ),
  ]);
  const generations = await Promise.all(rows.map((row) => generationView(db, row)));

  return (
    <AppShell
      active="usage"
      user={shellUser(actor)}
      availableCredits={wallet.available}
      planName={entitlements.plan?.name ?? null}
      title="Generation history"
    >
      <div className="page-head">
        <div>
          <div className="page-eyebrow">USAGE &amp; HISTORY</div>
          <h1 className="page-title">Generation history</h1>
          <p className="page-sub">Every AI job, its status, and exactly what it cost in credits.</p>
        </div>
        <div className="head-actions">
          <Link href="/billing" className="btn btn-secondary">
            <Wallet size={15} /> Credits &amp; billing
          </Link>
        </div>
      </div>

      <div className="grid grid-4 mb-3">
        <div className="stat">
          <div className="stat-label">Total jobs</div>
          <div className="stat-value">{totals?.jobs ?? 0}</div>
          <div className="stat-meta">{totals?.failed ?? 0} failed (auto-refunded)</div>
        </div>
        <div className="stat">
          <div className="stat-label"><Film size={13} /> Videos</div>
          <div className="stat-value">{totals?.videos ?? 0}</div>
          <div className="stat-meta">All time</div>
        </div>
        <div className="stat">
          <div className="stat-label"><ImageIcon size={13} /> Images</div>
          <div className="stat-value">{totals?.images ?? 0}</div>
          <div className="stat-meta">All time</div>
        </div>
        <div className="stat">
          <div className="stat-label"><Wallet size={13} /> Credits spent</div>
          <div className="stat-value stat-accent">{formatCredits(totals?.credits ?? 0)}</div>
          <div className="stat-meta">{formatCredits(wallet.balance)} in balance</div>
        </div>
      </div>

      <div className="split">
        <section className="card">
          <div className="card-head">
            <div>
              <h3>Recent jobs</h3>
              <p>Newest first. Jobs keep running if you close the tab.</p>
            </div>
          </div>
          <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Status</th>
                  <th>Type</th>
                  <th className="num">Credits</th>
                  <th className="num">When</th>
                </tr>
              </thead>
              <tbody>
                {generations.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <Link href={`/studio/${job.projectId}`} className="strong">
                        {job.modelName ?? job.capability.replace(/_/g, " ")}
                      </Link>
                      <div className="tiny muted truncate" style={{ maxWidth: 280 }}>
                        {job.prompt}
                      </div>
                    </td>
                    <td>{statusBadge(job.status)}</td>
                    <td className="tiny">{job.capability.replace(/_/g, " ")}</td>
                    <td className="num">{job.creditsCharged || job.creditsReserved}</td>
                    <td className="num tiny">{relativeTime(job.createdAt)}</td>
                  </tr>
                ))}
                {!generations.length ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="empty" style={{ border: 0 }}>
                        <div className="empty-icon"><Clock size={20} /></div>
                        <strong>No generations yet</strong>
                        <p>Create a project and generate your first clip or image.</p>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="card">
          <div className="card-head">
            <h3>Credit ledger</h3>
            <span className="tiny muted">Append-only</span>
          </div>
          <div className="card-body" style={{ paddingTop: 8 }}>
            {ledger.length ? (
              ledger.map((entry) => (
                <div className="history-row" key={entry.id}>
                  <span className="icon-box">
                    <Wallet size={14} />
                  </span>
                  <span className="history-main">
                    <b className="truncate">{entry.description || entry.kind}</b>
                    <span title={formatDateTime(entry.created_at)}>{relativeTime(entry.created_at)}</span>
                  </span>
                  <span className={`history-amount ${entry.amount > 0 ? "stat-accent" : ""}`} style={{ color: entry.amount > 0 ? "var(--lime)" : "var(--soft)" }}>
                    {entry.amount > 0 ? "+" : ""}{formatCredits(entry.amount)}
                    <div className="tiny muted">{formatCredits(entry.balance_after)} bal.</div>
                  </span>
                </div>
              ))
            ) : (
              <p className="muted small">No ledger entries yet.</p>
            )}
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
