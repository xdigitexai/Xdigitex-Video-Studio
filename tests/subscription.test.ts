import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, id } from "./helpers/test-db";
import {
  activatePlan,
  cancelSubscription,
  getEntitlements,
  getSubscriptionById,
  latestSubscription,
  refreshSubscription,
  schedulePlanChange,
  subscriptionIsUsable,
} from "../lib/server/plans";

async function createUser(db: ReturnType<typeof createTestDb>, email: string) {
  const userId = id("usr");
  const timestamp = Date.now();
  await db.run(
    `INSERT INTO users (id, email, email_normalized, password_hash, display_name, role, status, email_verified_at, legacy_owner_id, last_login_at, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 'Test', 'customer', 'active', ?, NULL, NULL, ?, ?)`,
    [userId, email, email, timestamp, timestamp, timestamp],
  );
  return userId;
}

test("activating a plan creates a subscription with plan entitlements", async () => {
  const db = createTestDb();
  const userId = await createUser(db, "sub@studio.test");
  const activation = await activatePlan(db, { userId, planId: "plan_starter" });
  assert.equal(activation.extended, false);
  assert.ok(activation.periodEnd > activation.periodStart);
  assert.equal(activation.creditsToGrant, 1000);

  const entitlements = await getEntitlements(db, userId);
  assert.equal(entitlements.status, "active");
  assert.equal(entitlements.canGenerate, true);
  assert.equal(entitlements.plan?.code, "starter");
  assert.equal(entitlements.limits.maxVideoDurationSeconds, 10);
  assert.deepEqual(entitlements.limits.resolutions, ["720p"]);
  assert.equal(entitlements.limits.maxConcurrentJobs, 1);
  assert.ok(entitlements.modelIds.includes("mdl_runway_gen45"));
  assert.ok(!entitlements.modelIds.includes("mdl_runway_aleph2"), "Starter excludes Aleph 2");
});

test("renewing the same plan extends the period and grants a new allocation", async () => {
  const db = createTestDb();
  const userId = await createUser(db, "renew@studio.test");
  const first = await activatePlan(db, { userId, planId: "plan_starter" });
  const renewal = await activatePlan(db, { userId, planId: "plan_starter" });
  assert.equal(renewal.extended, true);
  assert.equal(renewal.subscription.id, first.subscription.id);
  assert.ok(renewal.periodStart >= first.periodEnd - 1000);
  assert.ok(renewal.periodEnd > first.periodEnd);
});

test("an elapsed period enters a grace window, then expires", async () => {
  const db = createTestDb();
  const userId = await createUser(db, "grace@studio.test");
  const activation = await activatePlan(db, { userId, planId: "plan_starter" });
  const pastEnd = Date.now() - 5_000;

  await db.run(`UPDATE subscriptions SET current_period_end = ? WHERE id = ?`, [pastEnd, activation.subscription.id]);
  const lapsed = await refreshSubscription(db, (await latestSubscription(db, userId))!, 3);
  assert.equal(lapsed.status, "past_due");
  assert.ok((lapsed.grace_ends_at ?? 0) > Date.now());
  assert.equal(subscriptionIsUsable(lapsed), true);

  const duringGrace = await getEntitlements(db, userId);
  assert.equal(duringGrace.status, "past_due");
  assert.equal(duringGrace.canGenerate, true);

  await db.run(`UPDATE subscriptions SET grace_ends_at = ? WHERE id = ?`, [Date.now() - 1_000, lapsed.id]);
  const expired = await refreshSubscription(db, (await latestSubscription(db, userId))!, 3);
  assert.equal(expired.status, "expired");
  assert.equal(subscriptionIsUsable(expired), false);

  const afterExpiry = await getEntitlements(db, userId);
  assert.equal(afterExpiry.canGenerate, false);
  assert.equal(afterExpiry.plan, null);
  assert.equal(afterExpiry.limits.maxConcurrentJobs, 0);
});

test("cancel-at-period-end expires without an unpaid grace period", async () => {
  const db = createTestDb();
  const userId = await createUser(db, "cancel@studio.test");
  const activation = await activatePlan(db, { userId, planId: "plan_starter" });
  const subscription = (await getSubscriptionById(db, activation.subscription.id))!;
  await cancelSubscription(db, subscription);
  assert.equal((await latestSubscription(db, userId))?.cancel_at_period_end, 1);

  await db.run(`UPDATE subscriptions SET current_period_end = ? WHERE id = ?`, [Date.now() - 1_000, subscription.id]);
  const refreshed = await refreshSubscription(db, (await latestSubscription(db, userId))!, 3);
  assert.equal(refreshed.status, "expired");
  assert.equal(refreshed.grace_ends_at, null);
});

test("plan changes can be scheduled for the end of the period", async () => {
  const db = createTestDb();
  const userId = await createUser(db, "change@studio.test");
  const activation = await activatePlan(db, { userId, planId: "plan_starter" });
  const subscription = (await getSubscriptionById(db, activation.subscription.id))!;
  await schedulePlanChange(db, subscription, "plan_premium");
  const updated = (await getSubscriptionById(db, subscription.id))!;
  assert.equal(updated.pending_plan_id, "plan_premium");
  assert.equal(updated.plan_change_effective_at, subscription.current_period_end);
});

test("premium unlocks 1080p, longer clips and more concurrency", async () => {
  const db = createTestDb();
  const userId = await createUser(db, "premium@studio.test");
  await activatePlan(db, { userId, planId: "plan_premium" });
  const entitlements = await getEntitlements(db, userId);
  assert.equal(entitlements.plan?.code, "premium");
  assert.equal(entitlements.limits.maxVideoDurationSeconds, 30);
  assert.deepEqual(entitlements.limits.resolutions, ["720p", "1080p"]);
  assert.equal(entitlements.limits.maxConcurrentJobs, 3);
  assert.ok(entitlements.modelIds.includes("mdl_runway_aleph2"));
});
