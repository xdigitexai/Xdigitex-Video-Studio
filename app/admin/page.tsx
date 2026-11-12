import Link from "next/link";
import {
  Activity,
  ArrowDownToLine,
  BarChart3,
  CircleDollarSign,
  CreditCard,
  Download,
  Filter,
  Gauge,
  Receipt,
  TrendingUp,
  TriangleAlert,
  Users,
  Video,
  Wallet,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { loadAdminFrame, shellUser } from "@/lib/server/frame";
import {
  adminOverview,
  filtersFromSearchParams,
  modelPerformance,
  providerPerformance,
  revenueSeries,
} from "@/lib/server/admin";
import { listPlans } from "@/lib/server/plans";
import { listModelRows, listProviders } from "@/lib/server/models";
import { normalizeEmail } from "@/lib/server/util";
import { formatCredits, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

function queryToObject(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") result[key] = entry;
    else if (Array.isArray(entry) && typeof entry[0] === "string") result[key] = entry[0];
  }
  return result;
}

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, unknown>> | Record<string, unknown>;
}) {
  const frame = await loadAdminFrame("/admin");
  const { db } = frame;
  const raw = await Promise.resolve(searchParams ?? {});
  const params = new URLSearchParams(queryToObject(raw));
  const filters = filtersFromSearchParams(params);
  const emailFilter = params.get("email")?.trim();
  if (emailFilter) {
    const user = await db.first<{ id: string }>(`SELECT id FROM users WHERE email_normalized = ?`, [
      normalizeEmail(emailFilter),
    ]);
    filters.userId = user?.id ?? "none";
  }

  const [kpis, providers, series, models, plans, providerList, modelList] = await Promise.all([
    adminOverview(db, filters),
    providerPerformance(db, filters),
    revenueSeries(db, filters),
    modelPerformance(db, filters),
    listPlans(db),
    listProviders(db),
    listModelRows(db),
  ]);

  const maxSeries = Math.max(1, ...series.map((point) => Math.max(point.revenueMicros, point.costMicros)));
  const exportQuery = params.toString();
  const grossPositive = kpis.grossProfitMicros >= 0;

  return (
    <AppShell
      active="admin"
      user={shellUser(frame.actor)}
      availableCredits={frame.wallet.available}
      planName={frame.entitlements.plan?.name ?? null}
      variant="admin"
      title="Business overview"
    >
      <div className="page-head">
        <div>
          <div className="page-eyebrow">ADMIN · FINANCE</div>
          <h1 className="page-title">Business overview</h1>
          <p className="page-sub">Revenue, provider spend, true gross profit and generation volume in real time.</p>
        </div>
        <div className="head-actions">
          <a className="btn btn-secondary btn-sm" href={`/api/admin/export?type=payments${exportQuery ? `&${exportQuery}` : ""}`}>
            <Download size={14} /> Payments CSV
          </a>
          <a className="btn btn-secondary btn-sm" href={`/api/admin/export?type=generations${exportQuery ? `&${exportQuery}` : ""}`}>
            <Download size={14} /> Usage CSV
          </a>
        </div>
      </div>

      <form className="admin-filter" method="get" action="/admin">
        <div className="field">
          <label className="label" htmlFor="since">From</label>
          <input className="input" id="since" name="since" type="date" defaultValue={params.get("since") ?? ""} />
        </div>
        <div className="field">
          <label className="label" htmlFor="until">To</label>
          <input className="input" id="until" name="until" type="date" defaultValue={params.get("until") ?? ""} />
        </div>
        <div className="field">
          <label className="label" htmlFor="email">Customer email</label>
          <input className="input" id="email" name="email" placeholder="exact email" defaultValue={params.get("email") ?? ""} />
        </div>
        <div className="field">
          <label className="label" htmlFor="providerId">Provider</label>
          <select className="select" id="providerId" name="providerId" defaultValue={params.get("providerId") ?? ""}>
            <option value="">All providers</option>
            {providerList.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="modelId">Model</label>
          <select className="select" id="modelId" name="modelId" defaultValue={params.get("modelId") ?? ""}>
            <option value="">All models</option>
            {modelList.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="planId">Plan</label>
          <select className="select" id="planId" name="planId" defaultValue={params.get("planId") ?? ""}>
            <option value="">All plans</option>
            {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="capability">Type</label>
          <select className="select" id="capability" name="capability" defaultValue={params.get("capability") ?? ""}>
            <option value="">All types</option>
            <option value="text_to_video">Text to video</option>
            <option value="image_to_video">Image to video</option>
            <option value="video_to_video">Video to video</option>
            <option value="text_to_image">Text to image</option>
            <option value="transcription">Transcription</option>
            <option value="prompt_enhance">Prompt enhancement</option>
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="status">Job status</label>
          <select className="select" id="status" name="status" defaultValue={params.get("status") ?? ""}>
            <option value="">All</option>
            <option value="SUCCEEDED">Succeeded</option>
            <option value="FAILED">Failed</option>
            <option value="PROCESSING">Processing</option>
          </select>
        </div>
        <button className="btn btn-primary btn-sm" type="submit"><Filter size={13} /> Apply</button>
        <Link className="btn btn-ghost btn-sm" href="/admin">Reset</Link>
      </form>

      <div className="grid grid-4 mb-3">
        <div className="stat">
          <div className="stat-label"><Users size={13} /> Registered users</div>
          <div className="stat-value">{kpis.totalUsers}</div>
          <div className="stat-meta">{kpis.activeSubscriptions} active subscriptions</div>
        </div>
        <div className="stat">
          <div className="stat-label"><CreditCard size={13} /> Subscription revenue</div>
          <div className="stat-value">{formatMoney(kpis.subscriptionRevenueMicros)}</div>
          <div className="stat-meta">{kpis.starterSubscribers} Starter · {kpis.premiumSubscribers} Premium</div>
        </div>
        <div className="stat">
          <div className="stat-label"><CircleDollarSign size={13} /> Credit revenue</div>
          <div className="stat-value">{formatMoney(kpis.creditRevenueMicros)}</div>
          <div className="stat-meta">One-time top-ups</div>
        </div>
        <div className="stat">
          <div className="stat-label"><TrendingUp size={13} /> Gross profit (cash)</div>
          <div className="stat-value" style={{ color: grossPositive ? "var(--lime)" : "var(--danger)" }}>
            {formatMoney(kpis.grossProfitMicros)}
          </div>
          <div className="stat-meta">Revenue minus provider spend</div>
        </div>
      </div>

      <div className="grid grid-4 mb-3">
        <div className="stat">
          <div className="stat-label"><BarChart3 size={13} /> Provider spend</div>
          <div className="stat-value">{formatMoney(kpis.providerCostMicros)}</div>
          <div className="stat-meta">Successful jobs only</div>
        </div>
        <div className="stat">
          <div className="stat-label"><Gauge size={13} /> ARPU</div>
          <div className="stat-value">{formatMoney(kpis.arpuMicros)}</div>
          <div className="stat-meta">Across {kpis.totalUsers} users</div>
        </div>
        <div className="stat">
          <div className="stat-label"><Video size={13} /> Generations</div>
          <div className="stat-value">{kpis.totalGenerations}</div>
          <div className="stat-meta">{kpis.videoGenerations} video · {kpis.imageGenerations} image · {kpis.failedGenerations} failed</div>
        </div>
        <div className="stat">
          <div className="stat-label"><Wallet size={13} /> Credit liability</div>
          <div className="stat-value">{formatCredits(kpis.walletLiabilityCredits)}</div>
          <div className="stat-meta">Outstanding customer credits</div>
        </div>
      </div>

      {kpis.outstandingPayments > 0 ? (
        <div className="notice notice-warn mb-3">
          <TriangleAlert size={16} />
          <span>
            {kpis.outstandingPayments} payment(s) need attention (pending over 15 minutes, failed, or fulfilment incomplete) ·{" "}
            {kpis.outstandingPaymentValueKes.toLocaleString()} KES.{" "}
            <Link href="/admin/payments" style={{ color: "var(--lime)", fontWeight: 600 }}>Review payments</Link>
          </span>
        </div>
      ) : null}

      <div className="split">
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <div>
                <h3>Revenue vs provider cost</h3>
                <p>Monthly cash revenue against provider spend.</p>
              </div>
              <div className="legend">
                <span><i style={{ background: "var(--lime)" }} /> Revenue</span>
                <span><i style={{ background: "rgba(251,113,133,0.6)" }} /> Cost</span>
              </div>
            </div>
            <div className="card-body">
              {series.length ? (
                <div className="bar-chart">
                  {series.map((point) => (
                    <div className="bar-col" key={point.bucket}>
                      <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: "100%", width: "100%", justifyContent: "center" }}>
                        <div className="bar-revenue" style={{ height: `${(point.revenueMicros / maxSeries) * 100}%`, width: 12 }} title={`Revenue ${formatMoney(point.revenueMicros)}`} />
                        <div className="bar-cost" style={{ height: `${(point.costMicros / maxSeries) * 100}%`, width: 12 }} title={`Cost ${formatMoney(point.costMicros)}`} />
                      </div>
                      <span>{point.bucket.slice(2)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty" style={{ border: 0, padding: "30px 10px" }}>
                  <div className="empty-icon"><BarChart3 size={19} /></div>
                  <strong>No financial activity in this range</strong>
                  <p>Revenue and cost appear once payments and generations exist.</p>
                </div>
              )}
              <div className="divider" />
              <div className="row wrap" style={{ gap: 26 }}>
                <div>
                  <div className="tiny muted">Billed generation value</div>
                  <b>{formatMoney(kpis.billedGenerationValueMicros)}</b>
                </div>
                <div>
                  <div className="tiny muted">Provider cost</div>
                  <b>{formatMoney(kpis.providerCostMicros)}</b>
                </div>
                <div>
                  <div className="tiny muted">Generation margin</div>
                  <b style={{ color: kpis.billedGenerationValueMicros - kpis.providerCostMicros >= 0 ? "var(--lime)" : "var(--danger)" }}>
                    {formatMoney(kpis.billedGenerationValueMicros - kpis.providerCostMicros)}
                  </b>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h3>Provider performance</h3>
                <p>Jobs, failures, cost and billed value per provider.</p>
              </div>
            </div>
            <div>
              {providers.length ? (
                providers.map((provider) => {
                  const margin = provider.billedMicros - provider.costMicros;
                  const rate = provider.jobs ? Math.round((provider.succeeded / provider.jobs) * 100) : 0;
                  return (
                    <div className="provider-row" key={provider.providerId ?? "legacy"}>
                      <div className="name">
                        <span className="provider-logo">{provider.code.slice(0, 2).toUpperCase()}</span>
                        <span style={{ minWidth: 0 }}>
                          <b className="truncate" style={{ display: "block" }}>{provider.providerName}</b>
                          <span className="tiny muted">{provider.jobs} jobs · {rate}% success</span>
                        </span>
                      </div>
                      <div className="num hide-mobile">{provider.failed} failed</div>
                      <div className="num hide-mobile">{formatMoney(provider.costMicros)}</div>
                      <div className="num">{formatMoney(provider.billedMicros)}</div>
                      <div className="right">
                        <span className={`margin-pill ${margin < 0 ? "negative" : ""}`}>{formatMoney(margin)}</span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="empty" style={{ border: 0 }}><p>No provider activity yet.</p></div>
              )}
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h3>Model performance</h3>
            </div>
            <div className="card-body" style={{ paddingTop: 8 }}>
              {models.length ? (
                models.slice(0, 8).map((model) => (
                  <div className="history-row" key={model.modelId}>
                    <span className="icon-box"><Activity size={14} /></span>
                    <span className="history-main">
                      <b className="truncate">{model.modelName}</b>
                      <span>{model.providerName} · {model.jobs} jobs · {formatCredits(model.credits)} cr</span>
                    </span>
                    <span className="history-amount tiny">
                      <div>{formatMoney(model.billedMicros)}</div>
                      <div className="muted">{formatMoney(model.costMicros)} cost</div>
                    </span>
                  </div>
                ))
              ) : (
                <p className="muted small">No model usage yet.</p>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Operations</h3>
            </div>
            <div className="card-body stack">
              <div className="row-between">
                <span className="small muted">Pending / failed payments</span>
                <span className={`badge ${kpis.outstandingPayments ? "badge-warn" : "badge-ok"}`}>{kpis.outstandingPayments}</span>
              </div>
              <div className="row-between">
                <span className="small muted">Failed generations</span>
                <span className={`badge ${kpis.failedGenerations ? "badge-danger" : "badge-ok"}`}>{kpis.failedGenerations}</span>
              </div>
              <Link href="/admin/payments" className="btn btn-secondary btn-block">
                <Receipt size={14} /> Payment reconciliation
              </Link>
              <Link href="/admin/providers" className="btn btn-ghost btn-block">
                <ArrowDownToLine size={14} /> Provider health &amp; keys
              </Link>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
