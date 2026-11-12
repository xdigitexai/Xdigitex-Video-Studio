/* eslint-disable @next/next/no-img-element -- media streams from the authenticated /api/assets route */
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clapperboard,
  CreditCard,
  Film,
  FolderOpen,
  Image as ImageIcon,
  LoaderCircle,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { NewProjectButton } from "@/components/new-project-button";
import { loadFrame, shellUser } from "@/lib/server/frame";
import { listProjectCards } from "@/lib/server/projects";
import { listGenerations, generationView } from "@/lib/server/generation";
import { latestSubscription } from "@/lib/server/plans";
import { formatCredits, relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

function statusBadge(status: string) {
  if (status === "SUCCEEDED") return <span className="badge badge-ok"><CheckCircle2 size={11} /> Completed</span>;
  if (status === "FAILED") return <span className="badge badge-danger">Failed</span>;
  if (status === "CANCELED") return <span className="badge badge-muted">Cancelled</span>;
  return <span className="badge badge-warn"><LoaderCircle size={11} className="spin" /> {status === "QUEUED" ? "Queued" : "Processing"}</span>;
}

export default async function DashboardPage() {
  const frame = await loadFrame("/dashboard");
  const { db, actor, wallet, entitlements } = frame;
  const [projects, generations, subscription] = await Promise.all([
    listProjectCards(db, actor.user.id, 6),
    listGenerations(db, { userId: actor.user.id, limit: 5 }),
    latestSubscription(db, actor.user.id),
  ]);
  const recent = await Promise.all(generations.map((row) => generationView(db, row)));

  const videoLimit = entitlements.limits.videoLimit;
  const imageLimit = entitlements.limits.imageLimit;

  return (
    <AppShell
      active="dashboard"
      user={shellUser(actor)}
      availableCredits={wallet.available}
      planName={entitlements.plan?.name ?? null}
      title="Dashboard"
    >
      <div className="page-head">
        <div>
          <div className="page-eyebrow">WELCOME BACK</div>
          <h1 className="page-title">{actor.user.display_name.split(" ")[0]}, let&apos;s make something.</h1>
          <p className="page-sub">
            {entitlements.plan
              ? `You're on ${entitlements.plan.name}. ${formatCredits(wallet.available)} credits are ready to spend.`
              : "Choose a plan to unlock AI generation and your monthly credits."}
          </p>
        </div>
        <div className="head-actions">
          <NewProjectButton label="New video" />
          <Link href="/billing" className="btn btn-secondary">
            <Wallet size={15} /> Add credits
          </Link>
        </div>
      </div>

      {!entitlements.plan ? (
        <div className="card card-pad mb-3" style={{ borderColor: "rgba(200,243,90,0.35)", background: "linear-gradient(160deg, rgba(200,243,90,0.08), var(--panel) 60%)" }}>
          <div className="row-between wrap" style={{ gap: 16 }}>
            <div>
              <span className="badge badge-lime">NO ACTIVE PLAN</span>
              <h2 style={{ fontSize: 22, marginTop: 10 }}>Pick a plan to start generating</h2>
              <p className="muted small mt-1">
                Starter gives you 1,000 credits every month. Premium adds 1080p, priority queue and advanced models.
              </p>
            </div>
            <Link href="/billing" className="btn btn-primary">
              View plans <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      ) : null}

      <div className="grid grid-4 mb-3">
        <div className="stat">
          <div className="stat-label"><Wallet size={13} /> Available credits</div>
          <div className="stat-value stat-accent">{formatCredits(wallet.available)}</div>
          <div className="stat-meta">
            {wallet.reserved > 0 ? `${formatCredits(wallet.reserved)} reserved` : "No credits reserved"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label"><CreditCard size={13} /> Current plan</div>
          <div className="stat-value">{entitlements.plan?.name ?? "None"}</div>
          <div className="stat-meta">
            {subscription
              ? subscription.cancel_at_period_end
                ? "Cancels at period end"
                : `Renews ${new Date(subscription.current_period_end).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`
              : "No subscription yet"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label"><Film size={13} /> Videos this period</div>
          <div className="stat-value">
            {entitlements.usage.videos}
            <span className="muted" style={{ fontSize: 16 }}> / {videoLimit < 0 ? "∞" : videoLimit}</span>
          </div>
          <div className="stat-meta">{formatCredits(entitlements.limits.maxConcurrentJobs)} concurrent slots</div>
        </div>
        <div className="stat">
          <div className="stat-label"><ImageIcon size={13} /> Images this period</div>
          <div className="stat-value">
            {entitlements.usage.images}
            <span className="muted" style={{ fontSize: 16 }}> / {imageLimit < 0 ? "∞" : imageLimit}</span>
          </div>
          <div className="stat-meta">{entitlements.usage.concurrentJobs} job(s) running</div>
        </div>
      </div>

      {entitlements.status === "past_due" ? (
        <div className="notice notice-warn mb-3">
          <TriangleAlert size={16} />
          <span>
            Your last renewal is unpaid. Generate while your grace period lasts, or{" "}
            <Link href="/billing" style={{ color: "var(--lime)", fontWeight: 600 }}>pay the renewal</Link>.
          </span>
        </div>
      ) : null}

      <div className="split">
        <section>
          <div className="row-between mb-2">
            <h2 style={{ fontSize: 18 }}>Recent projects</h2>
            <Link href="/projects" className="small" style={{ color: "var(--lime)" }}>
              View all
            </Link>
          </div>
          {projects.length ? (
            <div className="grid grid-2">
              {projects.map((project) => (
                <Link href={`/studio/${project.id}`} className="project-card" key={project.id}>
                  <div className="project-thumb">
                    {project.thumbId && project.thumbType?.startsWith("image/") ? (
                      <img src={`/api/assets/${project.thumbId}`} alt="" loading="lazy" />
                    ) : project.thumbId && project.thumbType?.startsWith("video/") ? (
                      <video src={`/api/assets/${project.thumbId}#t=0.2`} muted preload="metadata" playsInline />
                    ) : (
                      <Clapperboard size={28} />
                    )}
                    <span className="thumb-badge badge badge-muted">{project.generationCount} AI</span>
                  </div>
                  <div className="project-meta">
                    <strong>{project.name}</strong>
                    <span>{project.assetCount} media · updated {relativeTime(project.updatedAt)}</span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty">
              <div className="empty-icon"><FolderOpen size={22} /></div>
              <strong>No projects yet</strong>
              <p>Create a project, upload footage, or generate your first clip with AI.</p>
              <NewProjectButton label="Create your first project" />
            </div>
          )}
        </section>

        <aside className="stack">
          <div className="card">
            <div className="card-head">
              <h3>Quick actions</h3>
            </div>
            <div className="card-body quick-actions">
              <Link href="/studio" className="quick-action">
                <Clapperboard size={17} /> Open studio
              </Link>
              <Link href="/library" className="quick-action">
                <Film size={17} /> Media library
              </Link>
              <Link href="/billing" className="quick-action">
                <Wallet size={17} /> Buy credits
              </Link>
              <Link href="/usage" className="quick-action">
                <ImageIcon size={17} /> Generation history
              </Link>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Latest generations</h3>
              <Link href="/usage" className="tiny" style={{ color: "var(--lime)" }}>All</Link>
            </div>
            <div className="card-body" style={{ paddingTop: 6, paddingBottom: 8 }}>
              {recent.length ? (
                recent.map((job) => (
                  <Link href={`/studio/${job.projectId}`} className="history-row" key={job.id}>
                    <span className="icon-box">
                      {job.capability.includes("image") ? <ImageIcon size={15} /> : <Film size={15} />}
                    </span>
                    <span className="history-main">
                      <b className="truncate">{job.modelName ?? job.capability.replace(/_/g, " ")}</b>
                      <span>{relativeTime(job.createdAt)} · {job.creditsCharged || job.creditsReserved} credits</span>
                    </span>
                    {statusBadge(job.status)}
                  </Link>
                ))
              ) : (
                <p className="muted small" style={{ padding: "12px 0" }}>
                  Your generations will appear here.
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
