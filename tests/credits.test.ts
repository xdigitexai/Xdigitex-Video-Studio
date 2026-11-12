import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, id } from "./helpers/test-db";
import {
  adjustCredits,
  ensureWallet,
  expireCredits,
  getWallet,
  grantCredits,
  listLedger,
  refundReservation,
  releaseReservation,
  reserveCredits,
  settleCredits,
} from "../lib/server/credits";

test("credits are granted, ledgered and idempotent", async () => {
  const db = createTestDb();
  const userId = id("usr");
  await ensureWallet(db, userId);

  const first = await grantCredits(db, {
    userId,
    credits: 100,
    source: "purchase",
    reference: "payment:pay_1:credits",
    bumpLifetime: "purchased",
  });
  assert.equal(first, true);
  let wallet = await getWallet(db, userId);
  assert.equal(wallet.balance, 100);
  assert.equal(wallet.available, 100);
  assert.equal(wallet.lifetimePurchased, 100);

  const replay = await grantCredits(db, {
    userId,
    credits: 100,
    source: "purchase",
    reference: "payment:pay_1:credits",
    bumpLifetime: "purchased",
  });
  assert.equal(replay, false, "replayed payment must not double-credit");
  wallet = await getWallet(db, userId);
  assert.equal(wallet.balance, 100);

  const ledger = await listLedger(db, userId);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].amount, 100);
  assert.equal(ledger[0].balance_after, 100);
});

test("reserve, settle and release never produce a negative balance", async () => {
  const db = createTestDb();
  const userId = id("usr");
  await grantCredits(db, { userId, credits: 100, source: "subscription", reference: "grant:1" });

  const reserved = await reserveCredits(db, { userId, generationId: "gen_1", amount: 60 });
  assert.equal(reserved.ok, true);
  let wallet = await getWallet(db, userId);
  assert.equal(wallet.reserved, 60);
  assert.equal(wallet.available, 40);

  const settlement = await settleCredits(db, {
    userId,
    generationId: "gen_1",
    amount: 50,
    reference: "gen:gen_1:consume",
  });
  assert.equal(settlement.applied, true);
  assert.equal(settlement.charged, 50);
  assert.equal(settlement.released, 10);
  wallet = await getWallet(db, userId);
  assert.equal(wallet.balance, 50);
  assert.equal(wallet.reserved, 0);
  assert.equal(wallet.available, 50);
  assert.equal(wallet.lifetimeConsumed, 50);

  const grants = await db.all<{ remaining: number }>(`SELECT remaining FROM credit_grants WHERE user_id = ?`, [userId]);
  assert.equal(grants.reduce((total, grant) => total + grant.remaining, 0), 50);
});

test("settlement is idempotent", async () => {
  const db = createTestDb();
  const userId = id("usr");
  await grantCredits(db, { userId, credits: 100, source: "subscription", reference: "grant:1" });
  await reserveCredits(db, { userId, generationId: "gen_1", amount: 40 });

  const first = await settleCredits(db, { userId, generationId: "gen_1", amount: 40, reference: "gen:gen_1:consume" });
  assert.equal(first.applied, true);
  const second = await settleCredits(db, { userId, generationId: "gen_1", amount: 40, reference: "gen:gen_1:consume" });
  assert.equal(second.applied, false);
  const wallet = await getWallet(db, userId);
  assert.equal(wallet.balance, 60);
  const ledger = await listLedger(db, userId);
  assert.equal(ledger.filter((entry) => entry.kind === "consume").length, 1);
});

test("a released reservation restores the full available balance", async () => {
  const db = createTestDb();
  const userId = id("usr");
  await grantCredits(db, { userId, credits: 100, source: "subscription", reference: "grant:1" });
  await reserveCredits(db, { userId, generationId: "gen_1", amount: 70 });
  const released = await releaseReservation(db, { userId, generationId: "gen_1" });
  assert.equal(released, true);
  const wallet = await getWallet(db, userId);
  assert.equal(wallet.balance, 100);
  assert.equal(wallet.reserved, 0);
  assert.equal(wallet.available, 100);
  const again = await releaseReservation(db, { userId, generationId: "gen_1" });
  assert.equal(again, false, "release must not run twice");
});

test("failed generations are refunded after settlement", async () => {
  const db = createTestDb();
  const userId = id("usr");
  await grantCredits(db, { userId, credits: 100, source: "subscription", reference: "grant:1" });
  await reserveCredits(db, { userId, generationId: "gen_1", amount: 40 });
  await settleCredits(db, { userId, generationId: "gen_1", amount: 40, reference: "gen:gen_1:consume" });
  assert.equal((await getWallet(db, userId)).balance, 60);

  const refunded = await refundReservation(db, {
    userId,
    generationId: "gen_1",
    amount: 40,
    reference: "gen:gen_1:refund",
  });
  assert.equal(refunded, true);
  assert.equal((await getWallet(db, userId)).balance, 100);

  const replay = await refundReservation(db, {
    userId,
    generationId: "gen_1",
    amount: 40,
    reference: "gen:gen_1:refund",
  });
  assert.equal(replay, false, "refund replays are idempotent");
  assert.equal((await getWallet(db, userId)).balance, 100);
});

test("an insufficient balance is rejected and leaves no reservation", async () => {
  const db = createTestDb();
  const userId = id("usr");
  await grantCredits(db, { userId, credits: 10, source: "subscription", reference: "grant:1" });
  const result = await reserveCredits(db, { userId, generationId: "gen_big", amount: 20 });
  assert.equal(result.ok, false);
  assert.equal(result.available, 10);
  assert.equal((await getWallet(db, userId)).balance, 10);
  const reservations = await db.all<{ status: string }>(`SELECT status FROM credit_reservations WHERE user_id = ?`, [userId]);
  assert.equal(reservations.length, 0);
});

test("concurrent reservations cannot overspend", async () => {
  const db = createTestDb();
  const userId = id("usr");
  await grantCredits(db, { userId, credits: 100, source: "subscription", reference: "grant:1" });
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      reserveCredits(db, { userId, generationId: `gen_${index}`, amount: 20 }),
    ),
  );
  const successes = results.filter((result) => result.ok).length;
  assert.equal(successes, 5);
  const wallet = await getWallet(db, userId);
  assert.equal(wallet.reserved, 100);
  assert.equal(wallet.available, 0);
});

test("expired credit lots are removed from the spendable balance once", async () => {
  const db = createTestDb();
  const userId = id("usr");
  await grantCredits(db, {
    userId,
    credits: 40,
    source: "subscription",
    reference: "grant:expiring",
    expiresAt: Date.now() - 1_000,
  });
  await grantCredits(db, { userId, credits: 60, source: "purchase", reference: "grant:permanent" });
  assert.equal((await getWallet(db, userId)).balance, 100);

  const expired = await expireCredits(db, userId);
  assert.equal(expired, 40);
  assert.equal((await getWallet(db, userId)).balance, 60);
  assert.equal(await expireCredits(db, userId), 0, "expiry is idempotent");

  const ledger = await listLedger(db, userId);
  assert.equal(ledger.filter((entry) => entry.kind === "expire").length, 1);
});

test("negative adjustments cannot push a wallet below its available balance", async () => {
  const db = createTestDb();
  const userId = id("usr");
  await grantCredits(db, { userId, credits: 30, source: "purchase", reference: "grant:1" });
  const rejected = await adjustCredits(db, {
    userId,
    credits: -50,
    reference: "admin-credit:1",
    description: "Too large",
  });
  assert.equal(rejected, false);
  assert.equal((await getWallet(db, userId)).balance, 30);

  const applied = await adjustCredits(db, {
    userId,
    credits: -20,
    reference: "admin-credit:2",
    description: "Correction",
  });
  assert.equal(applied, true);
  assert.equal((await getWallet(db, userId)).balance, 10);
});
