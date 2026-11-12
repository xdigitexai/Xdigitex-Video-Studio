import type { Db } from "./db";
import { DAY, now } from "./util";

export interface AdminFilters {
  since?: number;
  until?: number;
  userId?: string;
  providerId?: string;
  modelId?: string;
  planId?: string;
  capability?: string;
  status?: string;
}

interface Clause {
  sql: string[];
  params: Array<string | number>;
}

function generationFilters(filters: AdminFilters, alias = "g"): Clause {
  const sql: string[] = [];
  const params: Array<string | number> = [];
  if (filters.since) {
    sql.push(`${alias}.created_at >= ?`);
    params.push(filters.since);
  }
  if (filters.until) {
    sql.push(`${alias}.created_at <= ?`);
    params.push(filters.until);
  }
  if (filters.userId) {
    sql.push(`${alias}.owner_id = ?`);
    params.push(filters.userId);
  }
  if (filters.providerId) {
    sql.push(`${alias}.provider_id = ?`);
    params.push(filters.providerId);
  }
  if (filters.modelId) {
    sql.push(`${alias}.model_id = ?`);
    params.push(filters.modelId);
  }
  if (filters.capability) {
    sql.push(`${alias}.capability = ?`);
    params.push(filters.capability);
  }
  if (filters.status) {
    sql.push(`${alias}.status = ?`);
    params.push(filters.status);
  }
  return { sql, params };
}

function paymentFilters(filters: AdminFilters, alias = "p"): Clause {
  const sql: string[] = [];
  const params: Array<string | number> = [];
  if (filters.since) {
    sql.push(`${alias}.created_at >= ?`);
    params.push(filters.since);
  }
  if (filters.until) {
    sql.push(`${alias}.created_at <= ?`);
    params.push(filters.until);
  }
  if (filters.userId) {
    sql.push(`${alias}.user_id = ?`);
    params.push(filters.userId);
  }
  if (filters.planId) {
    sql.push(`${alias}.plan_id = ?`);
    params.push(filters.planId);
  }
  return { sql, params };
}

function where(clause: Clause, extra: string[] = []): string {
  const all = [...clause.sql, ...extra];
  return all.length ? `WHERE ${all.join(" AND ")}` : "";
}

export interface OverviewKpis {
  totalUsers: number;
  activeSubscriptions: number;
  starterSubscribers: number;
  premiumSubscribers: number;
  subscriptionRevenueMicros: number;
  creditRevenueMicros: number;
  providerCostMicros: number;
  billedGenerationValueMicros: number;
  grossProfitMicros: number;
  arpuMicros: number;
  imageGenerations: number;
  videoGenerations: number;
  failedGenerations: number;
  totalGenerations: number;
  outstandingPayments: number;
  outstandingPaymentValueKes: number;
  walletLiabilityCredits: number;
}

export async function adminOverview(db: Db, filters: AdminFilters): Promise<OverviewKpis> {
  const gen = generationFilters(filters);
  const pay = paymentFilters(filters);
  const [
    users,
    activeSubs,
    starterSubs,
    premiumSubs,
    subscriptionRevenue,
    creditRevenue,
    providerCost,
    billedValue,
    imageCount,
    videoCount,
    failedCount,
    totalCount,
    outstanding,
    walletLiability,
  ] = await Promise.all([
    db.first<{ count: number }>(`SELECT COUNT(*) AS count FROM users`),
    db.first<{ count: number }>(`SELECT COUNT(*) AS count FROM subscriptions WHERE status IN ('active','past_due')`),
    db.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM subscriptions s JOIN plans p ON p.id = s.plan_id
       WHERE s.status IN ('active','past_due') AND p.code = 'starter'`,
    ),
    db.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM subscriptions s JOIN plans p ON p.id = s.plan_id
       WHERE s.status IN ('active','past_due') AND p.code = 'premium'`,
    ),
    db.first<{ total: number }>(
      `SELECT COALESCE(SUM(p.price_usd_cents * 10000), 0) AS total FROM payments p
       ${where(pay, ["p.status = 'completed'", "p.purpose IN ('subscription','subscription_renewal','plan_change')"])}`,
      pay.params,
    ),
    db.first<{ total: number }>(
      `SELECT COALESCE(SUM(p.price_usd_cents * 10000), 0) AS total FROM payments p
       ${where(pay, ["p.status = 'completed'", "p.purpose = 'credit_topup'"])}`,
      pay.params,
    ),
    db.first<{ total: number }>(
      `SELECT COALESCE(SUM(s.provider_cost_micros), 0) AS total
       FROM pricing_snapshots s JOIN generations g ON g.id = s.generation_id
       ${where(gen, ["g.status = 'SUCCEEDED'"])}`,
      gen.params,
    ),
    db.first<{ total: number }>(
      `SELECT COALESCE(SUM(s.selling_price_micros), 0) AS total
       FROM pricing_snapshots s JOIN generations g ON g.id = s.generation_id
       ${where(gen, ["g.status = 'SUCCEEDED'"])}`,
      gen.params,
    ),
    db.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM generations g ${where(gen, [
        "g.capability IN ('text_to_image','image_edit','image_variations')",
      ])}`,
      gen.params,
    ),
    db.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM generations g ${where(gen, [
        "g.capability IN ('text_to_video','image_to_video','video_to_video')",
      ])}`,
      gen.params,
    ),
    db.first<{ count: number }>(`SELECT COUNT(*) AS count FROM generations g ${where(gen, ["g.status = 'FAILED'"])}`, gen.params),
    db.first<{ count: number }>(`SELECT COUNT(*) AS count FROM generations g ${where(gen)}`, gen.params),
    db.first<{ count: number; total: number }>(
      `SELECT COUNT(*) AS count, COALESCE(SUM(p.amount_minor), 0) AS total FROM payments p
       WHERE (p.status = 'pending' AND p.created_at < ?) OR p.status = 'failed' OR p.fulfillment_error IS NOT NULL`,
      [now() - 15 * 60_000],
    ),
    db.first<{ total: number }>(`SELECT COALESCE(SUM(balance), 0) AS total FROM credit_wallets`),
  ]);

  const revenue = (subscriptionRevenue?.total ?? 0) + (creditRevenue?.total ?? 0);
  const totalUsers = users?.count ?? 0;
  return {
    totalUsers,
    activeSubscriptions: activeSubs?.count ?? 0,
    starterSubscribers: starterSubs?.count ?? 0,
    premiumSubscribers: premiumSubs?.count ?? 0,
    subscriptionRevenueMicros: subscriptionRevenue?.total ?? 0,
    creditRevenueMicros: creditRevenue?.total ?? 0,
    providerCostMicros: providerCost?.total ?? 0,
    billedGenerationValueMicros: billedValue?.total ?? 0,
    grossProfitMicros: revenue - (providerCost?.total ?? 0),
    arpuMicros: totalUsers ? Math.round(revenue / totalUsers) : 0,
    imageGenerations: imageCount?.count ?? 0,
    videoGenerations: videoCount?.count ?? 0,
    failedGenerations: failedCount?.count ?? 0,
    totalGenerations: totalCount?.count ?? 0,
    outstandingPayments: outstanding?.count ?? 0,
    outstandingPaymentValueKes: (outstanding?.total ?? 0) / 100,
    walletLiabilityCredits: walletLiability?.total ?? 0,
  };
}

export interface ProviderPerformance {
  providerId: string | null;
  providerName: string;
  code: string;
  jobs: number;
  succeeded: number;
  failed: number;
  costMicros: number;
  billedMicros: number;
  marginMicros: number;
}

export async function providerPerformance(db: Db, filters: AdminFilters): Promise<ProviderPerformance[]> {
  const gen = generationFilters(filters);
  const rows = await db.all<{
    provider_id: string | null;
    provider_name: string | null;
    code: string | null;
    jobs: number;
    succeeded: number;
    failed: number;
    cost: number;
    billed: number;
  }>(
    `SELECT g.provider_id AS provider_id, p.name AS provider_name, p.code AS code,
       COUNT(g.id) AS jobs,
       SUM(CASE WHEN g.status = 'SUCCEEDED' THEN 1 ELSE 0 END) AS succeeded,
       SUM(CASE WHEN g.status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
       COALESCE(SUM(s.provider_cost_micros), 0) AS cost,
       COALESCE(SUM(s.selling_price_micros), 0) AS billed
     FROM generations g
     LEFT JOIN pricing_snapshots s ON s.generation_id = g.id
     LEFT JOIN ai_providers p ON p.id = g.provider_id
     ${where(gen)}
     GROUP BY g.provider_id
     ORDER BY jobs DESC`,
    gen.params,
  );
  return rows.map((row) => ({
    providerId: row.provider_id,
    providerName: row.provider_name ?? "Legacy (Runway)",
    code: row.code ?? "runway",
    jobs: row.jobs,
    succeeded: row.succeeded,
    failed: row.failed,
    costMicros: row.cost,
    billedMicros: row.billed,
    marginMicros: row.billed - row.cost,
  }));
}

export interface SeriesPoint {
  bucket: string;
  revenueMicros: number;
  costMicros: number;
  jobs: number;
}

export async function revenueSeries(db: Db, filters: AdminFilters, months = 6): Promise<SeriesPoint[]> {
  const since = filters.since ?? now() - months * 31 * DAY;
  const payClause = paymentFilters({ ...filters, since });
  const genClause = generationFilters({ ...filters, since });
  const revenueRows = await db.all<{ bucket: string; total: number }>(
    `SELECT strftime('%Y-%m', p.created_at / 1000, 'unixepoch') AS bucket,
       COALESCE(SUM(p.price_usd_cents * 10000), 0) AS total
     FROM payments p ${where(payClause, ["p.status = 'completed'"])}
     GROUP BY bucket ORDER BY bucket ASC`,
    payClause.params,
  );
  const costRows = await db.all<{ bucket: string; total: number; jobs: number }>(
    `SELECT strftime('%Y-%m', g.created_at / 1000, 'unixepoch') AS bucket,
       COALESCE(SUM(s.provider_cost_micros), 0) AS total, COUNT(g.id) AS jobs
     FROM generations g LEFT JOIN pricing_snapshots s ON s.generation_id = g.id
     ${where(genClause)}
     GROUP BY bucket ORDER BY bucket ASC`,
    genClause.params,
  );
  const buckets = new Map<string, SeriesPoint>();
  for (const row of revenueRows) {
    buckets.set(row.bucket, { bucket: row.bucket, revenueMicros: row.total, costMicros: 0, jobs: 0 });
  }
  for (const row of costRows) {
    const point = buckets.get(row.bucket) ?? { bucket: row.bucket, revenueMicros: 0, costMicros: 0, jobs: 0 };
    point.costMicros = row.total;
    point.jobs = row.jobs;
    buckets.set(row.bucket, point);
  }
  return [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)).slice(-12);
}

export interface ModelPerformance {
  modelId: string;
  modelName: string;
  providerName: string;
  jobs: number;
  credits: number;
  costMicros: number;
  billedMicros: number;
}

export async function modelPerformance(db: Db, filters: AdminFilters): Promise<ModelPerformance[]> {
  const clause = generationFilters(filters);
  return db.all<ModelPerformance>(
    `SELECT g.model_id AS modelId, COALESCE(m.display_name, g.model_id, 'Unknown') AS modelName,
       COALESCE(p.name, 'Legacy') AS providerName,
       COUNT(g.id) AS jobs, COALESCE(SUM(g.credits_charged), 0) AS credits,
       COALESCE(SUM(s.provider_cost_micros), 0) AS costMicros,
       COALESCE(SUM(s.selling_price_micros), 0) AS billedMicros
     FROM generations g
     LEFT JOIN pricing_snapshots s ON s.generation_id = g.id
     LEFT JOIN ai_models m ON m.id = g.model_id
     LEFT JOIN ai_providers p ON p.id = g.provider_id
     ${where(clause, ["g.model_id IS NOT NULL"])}
     GROUP BY g.model_id ORDER BY jobs DESC LIMIT 20`,
    clause.params,
  );
}

export interface CustomerSummary {
  id: string;
  email: string;
  display_name: string;
  role: string;
  status: string;
  created_at: number;
  plan_id: string | null;
  plan_name: string | null;
  subscription_status: string | null;
  period_end: number | null;
  balance: number;
  reserved: number;
  generations: number;
}

export async function listCustomers(
  db: Db,
  options: { search?: string; limit?: number; offset?: number } = {},
): Promise<CustomerSummary[]> {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (options.search) {
    clauses.push("(u.email LIKE ? OR u.display_name LIKE ?)");
    params.push(`%${options.search}%`, `%${options.search}%`);
  }
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);
  return db.all<CustomerSummary>(
    `SELECT u.id, u.email, u.display_name, u.role, u.status, u.created_at,
       s.plan_id, pl.name AS plan_name, s.status AS subscription_status, s.current_period_end AS period_end,
       COALESCE(w.balance, 0) AS balance, COALESCE(w.reserved, 0) AS reserved,
       (SELECT COUNT(*) FROM generations g WHERE g.owner_id = u.id) AS generations
     FROM users u
     LEFT JOIN subscriptions s ON s.id = (
       SELECT id FROM subscriptions WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1
     )
     LEFT JOIN plans pl ON pl.id = s.plan_id
     LEFT JOIN credit_wallets w ON w.user_id = u.id
     ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
     ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
}

export async function customerDetail(db: Db, userId: string) {
  const user = await db.first<{
    id: string;
    email: string;
    display_name: string;
    role: string;
    status: string;
    created_at: number;
    email_verified_at: number | null;
  }>(`SELECT id, email, display_name, role, status, created_at, email_verified_at FROM users WHERE id = ?`, [userId]);
  if (!user) return null;
  const [wallet, subscription, payments, ledger, overrides, usage] = await Promise.all([
    db.first<{ balance: number; reserved: number; lifetime_consumed: number; lifetime_purchased: number }>(
      `SELECT balance, reserved, lifetime_consumed, lifetime_purchased FROM credit_wallets WHERE user_id = ?`,
      [userId],
    ),
    db.first<{
      id: string;
      plan_id: string;
      status: string;
      current_period_end: number;
      cancel_at_period_end: number;
      pending_plan_id: string | null;
      plan_name: string | null;
      price_cents: number;
    }>(
      `SELECT s.*, p.name AS plan_name, p.price_cents FROM subscriptions s LEFT JOIN plans p ON p.id = s.plan_id
       WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 1`,
      [userId],
    ),
    db.all<{ id: string; reference: string; purpose: string; status: string; amount_minor: number; credits: number; created_at: number }>(
      `SELECT id, reference, purpose, status, amount_minor, credits, created_at FROM payments
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`,
      [userId],
    ),
    db.all<{ id: string; kind: string; amount: number; balance_after: number; description: string; created_at: number }>(
      `SELECT id, kind, amount, balance_after, description, created_at FROM credit_ledger
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 15`,
      [userId],
    ),
    db.all<{
      id: string;
      label: string;
      margin_bps: number | null;
      fixed_price_micros: number | null;
      model_id: string | null;
      is_active: number;
    }>(`SELECT * FROM pricing_overrides WHERE user_id = ? ORDER BY updated_at DESC`, [userId]),
    db.first<{ jobs: number; credits: number }>(
      `SELECT COUNT(*) AS jobs, COALESCE(SUM(credits_charged), 0) AS credits FROM generations WHERE owner_id = ?`,
      [userId],
    ),
  ]);
  return { user, wallet, subscription, payments, ledger, overrides, usage };
}

export function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const header = columns.join(",");
  const body = rows
    .map((row) => columns.map((column) => csvEscape(row[column])).join(","))
    .join("\n");
  return `${header}\n${body}\n`;
}

export async function exportPaymentsCsv(db: Db, filters: AdminFilters): Promise<string> {
  const clause = paymentFilters(filters);
  const rows = await db.all<Record<string, unknown>>(
    `SELECT p.reference, p.provider_receipt, u.email, p.purpose, p.status,
       p.price_usd_cents / 100.0 AS price_usd, p.amount_minor / 100.0 AS amount_kes,
       p.credits, p.created_at, p.completed_at, p.failure_reason
     FROM payments p LEFT JOIN users u ON u.id = p.user_id
     ${where(clause)} ORDER BY p.created_at DESC LIMIT 10000`,
    clause.params,
  );
  return toCsv(rows, [
    "reference",
    "provider_receipt",
    "email",
    "purpose",
    "status",
    "price_usd",
    "amount_kes",
    "credits",
    "created_at",
    "completed_at",
    "failure_reason",
  ]);
}

export async function exportGenerationsCsv(db: Db, filters: AdminFilters): Promise<string> {
  const clause = generationFilters(filters);
  const rows = await db.all<Record<string, unknown>>(
    `SELECT g.id, u.email, g.capability, COALESCE(p.name, 'Legacy') AS provider,
       COALESCE(m.display_name, g.model_id) AS model, g.status, g.duration,
       g.credits_reserved, g.credits_charged,
       s.provider_cost_micros / 1000000.0 AS provider_cost_usd,
       s.selling_price_micros / 1000000.0 AS selling_price_usd,
       s.margin_bps, s.estimated, s.config_version, g.created_at, g.completed_at
     FROM generations g
     LEFT JOIN users u ON u.id = g.owner_id
     LEFT JOIN pricing_snapshots s ON s.generation_id = g.id
     LEFT JOIN ai_providers p ON p.id = g.provider_id
     LEFT JOIN ai_models m ON m.id = g.model_id
     ${where(clause)} ORDER BY g.created_at DESC LIMIT 10000`,
    clause.params,
  );
  return toCsv(rows, [
    "id",
    "email",
    "capability",
    "provider",
    "model",
    "status",
    "duration",
    "credits_reserved",
    "credits_charged",
    "provider_cost_usd",
    "selling_price_usd",
    "margin_bps",
    "estimated",
    "config_version",
    "created_at",
    "completed_at",
  ]);
}

export function filtersFromSearchParams(params: URLSearchParams): AdminFilters {
  const date = (key: string) => {
    const value = params.get(key);
    if (!value) return undefined;
    const parsed = Date.parse(value.length <= 10 ? `${value}T00:00:00Z` : value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return {
    since: date("since"),
    until: date("until") ? (date("until") as number) + DAY - 1 : undefined,
    userId: params.get("userId") || undefined,
    providerId: params.get("providerId") || undefined,
    modelId: params.get("modelId") || undefined,
    planId: params.get("planId") || undefined,
    capability: params.get("capability") || undefined,
    status: params.get("status") || undefined,
  } as AdminFilters;
}


/** Normalises Next's searchParams (plain object or promise) into a string map. */
export async function resolveSearchParams(
  input?: Promise<Record<string, unknown>> | Record<string, unknown>,
): Promise<URLSearchParams> {
  const raw = await Promise.resolve(input ?? {});
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value) && typeof value[0] === "string") params.set(key, value[0]);
  }
  return params;
}
