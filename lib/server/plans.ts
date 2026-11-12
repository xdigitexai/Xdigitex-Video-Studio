import type { Db } from "./db";
import { DAY, monthEnd, now, parseJson } from "./util";

export interface PlanRow {
  id: string;
  code: string;
  name: string;
  description: string;
  price_cents: number;
  currency: string;
  interval_months: number;
  credits_per_period: number;
  video_limit: number;
  image_limit: number;
  max_video_duration_seconds: number;
  resolutions: string;
  queue_priority: number;
  max_concurrent_jobs: number;
  storage_limit_mb: number;
  premium_features: string;
  is_active: number;
  sort_order: number;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface SubscriptionRow {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  current_period_start: number;
  current_period_end: number;
  cancel_at_period_end: number;
  grace_ends_at: number | null;
  pending_plan_id: string | null;
  plan_change_effective_at: number | null;
  price_cents_snapshot: number;
  currency: string;
  created_at: number;
  updated_at: number;
  canceled_at: number | null;
}

export type SubscriptionStatus = "active" | "past_due" | "canceled" | "expired";

export const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  past_due: "Payment due",
  canceled: "Canceled",
  expired: "Expired",
};

export interface PlanView extends Omit<PlanRow, "resolutions" | "premium_features"> {
  resolutions: string[];
  premiumFeatures: string[];
  priceUsd: number;
}

export function toPlanView(row: PlanRow): PlanView {
  const { resolutions, premium_features, ...rest } = row;
  return {
    ...rest,
    resolutions: parseJson<string[]>(resolutions, []),
    premiumFeatures: parseJson<string[]>(premium_features, []),
    priceUsd: row.price_cents / 100,
  };
}

export async function listPlans(db: Db, options: { activeOnly?: boolean } = {}): Promise<PlanRow[]> {
  return db.all<PlanRow>(
    `SELECT * FROM plans ${options.activeOnly ? "WHERE is_active = 1" : ""} ORDER BY sort_order ASC, price_cents ASC`,
  );
}

export async function getPlan(db: Db, idOrCode: string): Promise<PlanRow | null> {
  return db.first<PlanRow>(`SELECT * FROM plans WHERE id = ? OR code = ? LIMIT 1`, [idOrCode, idOrCode]);
}

export async function planModelIds(db: Db, planId: string): Promise<string[]> {
  const rows = await db.all<{ model_id: string }>(`SELECT model_id FROM plan_models WHERE plan_id = ?`, [planId]);
  return rows.map((row) => row.model_id);
}

export async function latestSubscription(db: Db, userId: string): Promise<SubscriptionRow | null> {
  return db.first<SubscriptionRow>(
    `SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
}

export async function getSubscriptionById(db: Db, id: string): Promise<SubscriptionRow | null> {
  return db.first<SubscriptionRow>(`SELECT * FROM subscriptions WHERE id = ?`, [id]);
}

export function subscriptionIsUsable(subscription: SubscriptionRow | null, timestamp = now()): boolean {
  if (!subscription) return false;
  if (subscription.status === "active") return subscription.current_period_end > timestamp;
  if (subscription.status === "past_due") {
    return Boolean(subscription.grace_ends_at && subscription.grace_ends_at > timestamp);
  }
  return false;
}

/**
 * Lazy lifecycle sweep for one user. Keeps subscriptions consistent without a
 * background scheduler: an elapsed period moves to past_due with a grace window,
 * and a lapsed grace window expires the subscription.
 */
export async function refreshSubscription(
  db: Db,
  subscription: SubscriptionRow,
  graceDays: number,
): Promise<SubscriptionRow> {
  const timestamp = now();
  if (subscription.status === "active" && subscription.current_period_end <= timestamp) {
    if (subscription.cancel_at_period_end) {
      await db.run(
        `UPDATE subscriptions SET status = 'expired', canceled_at = ?, updated_at = ? WHERE id = ? AND status = 'active'`,
        [subscription.current_period_end, timestamp, subscription.id],
      );
      await recordSubscriptionEvent(db, subscription, "expired", { reason: "period_ended_after_cancel" });
    } else {
      const graceEndsAt = subscription.current_period_end + Math.max(0, graceDays) * DAY;
      await db.run(
        `UPDATE subscriptions SET status = 'past_due', grace_ends_at = ?, updated_at = ? WHERE id = ? AND status = 'active'`,
        [graceEndsAt, timestamp, subscription.id],
      );
      await recordSubscriptionEvent(db, subscription, "past_due", { graceEndsAt });
    }
    return (await getSubscriptionById(db, subscription.id)) ?? subscription;
  }
  if (
    subscription.status === "past_due" &&
    subscription.grace_ends_at &&
    subscription.grace_ends_at <= timestamp
  ) {
    await db.run(
      `UPDATE subscriptions SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'past_due'`,
      [timestamp, subscription.id],
    );
    await recordSubscriptionEvent(db, subscription, "expired", { reason: "grace_elapsed" });
    return (await getSubscriptionById(db, subscription.id)) ?? subscription;
  }
  return subscription;
}

export async function recordSubscriptionEvent(
  db: Db,
  subscription: Pick<SubscriptionRow, "id" | "user_id">,
  type: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await db.run(
    `INSERT INTO subscription_events (id, subscription_id, user_id, type, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [`sev_${crypto.randomUUID().replace(/-/g, "")}`, subscription.id, subscription.user_id, type, JSON.stringify(detail), now()],
  );
}

export interface Entitlements {
  plan: PlanRow | null;
  subscription: SubscriptionRow | null;
  status: "active" | "past_due" | "none" | "expired" | "canceled";
  canGenerate: boolean;
  periodStart: number;
  periodEnd: number;
  limits: {
    videoLimit: number;
    imageLimit: number;
    maxVideoDurationSeconds: number;
    resolutions: string[];
    maxConcurrentJobs: number;
    storageLimitBytes: number;
    queuePriority: number;
    premiumFeatures: string[];
  };
  modelIds: string[];
  usage: { videos: number; images: number; storageBytes: number; concurrentJobs: number };
}

const NO_LIMITS: Entitlements["limits"] = {
  videoLimit: 0,
  imageLimit: 0,
  maxVideoDurationSeconds: 0,
  resolutions: [],
  maxConcurrentJobs: 0,
  storageLimitBytes: 0,
  queuePriority: 0,
  premiumFeatures: [],
};

export async function getEntitlements(db: Db, userId: string, graceDays = 3): Promise<Entitlements> {
  let subscription = await latestSubscription(db, userId);
  if (subscription) subscription = await refreshSubscription(db, subscription, graceDays);
  const usable = subscriptionIsUsable(subscription);
  const plan = usable && subscription ? await getPlan(db, subscription.plan_id) : null;
  const periodStart = subscription?.current_period_start ?? 0;

  const [videoRow, imageRow, storageRow, concurrentRow] = await Promise.all([
    db.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM generations
       WHERE owner_id = ? AND created_at >= ? AND capability IN ('text_to_video','image_to_video','video_to_video')
         AND status NOT IN ('FAILED','CANCELED')`,
      [userId, periodStart],
    ),
    db.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM generations
       WHERE owner_id = ? AND created_at >= ? AND capability IN ('text_to_image','image_edit','image_variations')
         AND status NOT IN ('FAILED','CANCELED')`,
      [userId, periodStart],
    ),
    db.first<{ total: number }>(`SELECT COALESCE(SUM(byte_size), 0) AS total FROM assets WHERE owner_id = ?`, [userId]),
    db.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM generations WHERE owner_id = ? AND status IN ('QUEUED','SUBMITTED','PROCESSING')`,
      [userId],
    ),
  ]);

  const planRow = plan;
  return {
    plan,
    subscription,
    status: usable ? (subscription?.status === "past_due" ? "past_due" : "active") : subscription ? "expired" : "none",
    canGenerate: Boolean(planRow),
    periodStart,
    periodEnd: subscription?.current_period_end ?? 0,
    limits: planRow
      ? {
          videoLimit: planRow.video_limit,
          imageLimit: planRow.image_limit,
          maxVideoDurationSeconds: planRow.max_video_duration_seconds,
          resolutions: parseJson<string[]>(planRow.resolutions, ["720p"]),
          maxConcurrentJobs: planRow.max_concurrent_jobs,
          storageLimitBytes: planRow.storage_limit_mb * 1024 * 1024,
          queuePriority: planRow.queue_priority,
          premiumFeatures: parseJson<string[]>(planRow.premium_features, []),
        }
      : NO_LIMITS,
    modelIds: planRow ? await planModelIds(db, planRow.id) : [],
    usage: {
      videos: videoRow?.count ?? 0,
      images: imageRow?.count ?? 0,
      storageBytes: storageRow?.total ?? 0,
      concurrentJobs: concurrentRow?.count ?? 0,
    },
  };
}

export function limitReached(limit: number, used: number): boolean {
  if (limit < 0) return false;
  return used >= limit;
}

export interface ActivatePlanInput {
  userId: string;
  planId: string;
  paymentId?: string | null;
  months?: number;
  now?: number;
  grantCredits?: boolean;
}

export interface ActivationResult {
  subscription: SubscriptionRow;
  periodStart: number;
  periodEnd: number;
  extended: boolean;
  creditsToGrant: number;
}

/**
 * Starts or renews a subscription period. Credit granting is performed by the
 * caller with an idempotent ledger reference keyed to the payment.
 */
export async function activatePlan(db: Db, input: ActivatePlanInput): Promise<ActivationResult> {
  const timestamp = input.now ?? now();
  const plan = await getPlan(db, input.planId);
  if (!plan) throw new Error("Plan not found.");
  const current = await latestSubscription(db, input.userId);
  const months = input.months ?? Math.max(1, plan.interval_months);

  if (current && subscriptionIsUsable(current, timestamp) && current.plan_id === plan.id) {
    const start = Math.max(timestamp, current.current_period_end);
    const end = monthEnd(start, months);
    await db.run(
      `UPDATE subscriptions
       SET status = 'active', current_period_start = ?, current_period_end = ?, cancel_at_period_end = 0,
           grace_ends_at = NULL, pending_plan_id = NULL, plan_change_effective_at = NULL, updated_at = ?
       WHERE id = ?`,
      [start, end, timestamp, current.id],
    );
    await recordSubscriptionEvent(db, current, "renewed", { paymentId: input.paymentId, periodStart: start, periodEnd: end });
    return {
      subscription: (await getSubscriptionById(db, current.id))!,
      periodStart: start,
      periodEnd: end,
      extended: true,
      creditsToGrant: plan.credits_per_period,
    };
  }

  const periodStart = timestamp;
  const periodEnd = monthEnd(periodStart, months);
  const id = `sub_${crypto.randomUUID().replace(/-/g, "")}`;
  await db.run(
    `INSERT INTO subscriptions (id, user_id, plan_id, status, current_period_start, current_period_end,
       cancel_at_period_end, grace_ends_at, pending_plan_id, plan_change_effective_at,
       price_cents_snapshot, currency, created_at, updated_at, canceled_at)
     VALUES (?, ?, ?, 'active', ?, ?, 0, NULL, NULL, NULL, ?, ?, ?, ?, NULL)`,
    [id, input.userId, plan.id, periodStart, periodEnd, plan.price_cents, plan.currency, timestamp, timestamp],
  );
  if (current) {
    await db.run(
      `UPDATE subscriptions SET status = 'canceled', updated_at = ? WHERE id = ? AND status IN ('active','past_due')`,
      [timestamp, current.id],
    );
    await recordSubscriptionEvent(db, current, "superseded", { newSubscriptionId: id });
  }
  const subscription = (await getSubscriptionById(db, id))!;
  await recordSubscriptionEvent(db, subscription, "activated", {
    paymentId: input.paymentId,
    planId: plan.id,
    periodStart,
    periodEnd,
  });
  return { subscription, periodStart, periodEnd, extended: false, creditsToGrant: plan.credits_per_period };
}

export async function schedulePlanChange(
  db: Db,
  subscription: SubscriptionRow,
  planId: string,
): Promise<void> {
  await db.run(
    `UPDATE subscriptions SET pending_plan_id = ?, plan_change_effective_at = current_period_end, updated_at = ?
     WHERE id = ? AND status IN ('active','past_due')`,
    [planId, now(), subscription.id],
  );
  await recordSubscriptionEvent(db, subscription, "plan_change_scheduled", { planId });
}

export async function cancelSubscription(db: Db, subscription: SubscriptionRow): Promise<void> {
  await db.run(
    `UPDATE subscriptions SET cancel_at_period_end = 1, updated_at = ? WHERE id = ? AND status IN ('active','past_due')`,
    [now(), subscription.id],
  );
  await recordSubscriptionEvent(db, subscription, "cancel_scheduled", {});
}

export async function resumeSubscription(db: Db, subscription: SubscriptionRow): Promise<void> {
  await db.run(
    `UPDATE subscriptions SET cancel_at_period_end = 0, updated_at = ? WHERE id = ? AND status IN ('active','past_due')`,
    [now(), subscription.id],
  );
  await recordSubscriptionEvent(db, subscription, "resumed", {});
}
