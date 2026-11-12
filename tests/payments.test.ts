import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, id } from "./helpers/test-db";
import {
  applyGatewayResult,
  createPayment,
  getPayment,
  paymentView,
  recordPaymentEvent,
} from "../lib/server/payments/service";
import {
  fetchPaymentStatus,
  initiateStkPush,
  normaliseKenyanPhone,
  signWebhookBody,
  verifyWebhookSignature,
} from "../lib/server/payments/xdigitex";
import { getWallet } from "../lib/server/credits";
import { latestSubscription } from "../lib/server/plans";

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

test("Kenyan phone numbers are normalised for STK push", () => {
  assert.equal(normaliseKenyanPhone("0712 345 678"), "254712345678");
  assert.equal(normaliseKenyanPhone("+254712345678"), "254712345678");
  assert.equal(normaliseKenyanPhone("0112345678"), "254112345678");
  assert.equal(normaliseKenyanPhone("254712345678"), "254712345678");
  assert.equal(normaliseKenyanPhone("12345"), null);
});

test("webhook signatures are HMAC-SHA256 over the raw body", async () => {
  const body = JSON.stringify({ event: "payment.completed", data: { checkoutRequestId: "ws_CO_1" } });
  const signature = await signWebhookBody("whsec_test", body);
  assert.match(signature, /^sha256=[0-9a-f]{64}$/);
  assert.equal(await verifyWebhookSignature("whsec_test", body, signature), true);
  assert.equal(await verifyWebhookSignature("whsec_test", body, `sha256=${"0".repeat(64)}`), false);
  assert.equal(await verifyWebhookSignature("whsec_test", `${body} `, signature), false);
  assert.equal(await verifyWebhookSignature("", body, signature), false);
});

test("a verified subscription payment activates the plan and grants credits exactly once", async () => {
  const db = createTestDb();
  const userId = await createUser(db, "pay@studio.test");
  const created = await createPayment(db, {
    userId,
    purpose: "subscription",
    planId: "plan_starter",
    credits: 1000,
    priceUsdCents: 1000,
  });
  // $10 at 130 KES/USD.
  assert.equal(created.payment.amount_minor, 130_000);
  assert.equal(created.amountKes, 1300);
  await db.run(`UPDATE payments SET provider_checkout_id = ? WHERE id = ?`, ["ws_CO_TEST_1", created.payment.id]);

  const payment = (await getPayment(db, created.payment.id))!;
  const result = await applyGatewayResult(db, payment, {
    status: "completed",
    receipt: "RCPT-1",
    amountKes: 1300,
    raw: { event: "payment.completed" },
    source: "webhook",
  });
  assert.equal(result.applied, true);
  assert.equal(result.payment.status, "completed");

  const wallet = await getWallet(db, userId);
  assert.equal(wallet.balance, 1000);
  assert.equal(wallet.lifetimeGranted, 1000);
  const subscription = await latestSubscription(db, userId);
  assert.equal(subscription?.status, "active");
  assert.equal(subscription?.plan_id, "plan_starter");
  assert.equal(result.payment.subscription_id, subscription?.id);

  const replay = await applyGatewayResult(db, (await getPayment(db, created.payment.id))!, {
    status: "completed",
    receipt: "RCPT-1",
    amountKes: 1300,
    raw: {},
    source: "status_poll",
  });
  assert.equal(replay.alreadyCompleted, true);
  assert.equal((await getWallet(db, userId)).balance, 1000, "replay must not grant credits twice");

  const grants = await db.all<{ count: number }>(`SELECT COUNT(*) AS count FROM credit_grants WHERE user_id = ?`, [userId]);
  assert.equal(grants[0].count, 1);
});

test("an amount mismatch fails the payment and allocates nothing", async () => {
  const db = createTestDb();
  const userId = await createUser(db, "mismatch@studio.test");
  const created = await createPayment(db, {
    userId,
    purpose: "subscription",
    planId: "plan_starter",
    credits: 1000,
    priceUsdCents: 1000,
  });
  const payment = (await getPayment(db, created.payment.id))!;
  const result = await applyGatewayResult(db, payment, {
    status: "completed",
    receipt: "RCPT-2",
    amountKes: 100,
    raw: {},
    source: "webhook",
  });
  assert.equal(result.applied, false);
  assert.match(result.error ?? "", /amount_mismatch/);
  const updated = (await getPayment(db, created.payment.id))!;
  assert.equal(updated.status, "failed");
  assert.equal((await getWallet(db, userId)).balance, 0);
  assert.equal(await latestSubscription(db, userId), null);
});

test("a reused M-Pesa receipt is rejected", async () => {
  const db = createTestDb();
  const userId = await createUser(db, "receipt@studio.test");
  const first = await createPayment(db, {
    userId,
    purpose: "subscription",
    planId: "plan_starter",
    credits: 1000,
    priceUsdCents: 1000,
  });
  const firstPayment = (await getPayment(db, first.payment.id))!;
  await applyGatewayResult(db, firstPayment, {
    status: "completed",
    receipt: "RCPT-DUP",
    amountKes: 1300,
    raw: {},
    source: "webhook",
  });

  const second = await createPayment(db, {
    userId,
    purpose: "credit_topup",
    packageId: "pack_500",
    credits: 500,
    priceUsdCents: 500,
  });
  const secondPayment = (await getPayment(db, second.payment.id))!;
  const result = await applyGatewayResult(db, secondPayment, {
    status: "completed",
    receipt: "RCPT-DUP",
    amountKes: 650,
    raw: {},
    source: "webhook",
  });
  assert.equal(result.applied, false);
  assert.match(result.error ?? "", /duplicate_receipt/);
  assert.equal((await getPayment(db, second.payment.id))?.status, "failed");
  assert.equal((await getWallet(db, userId)).balance, 1000);
});

test("credit top-ups add purchased credits and never expire", async () => {
  const db = createTestDb();
  const userId = await createUser(db, "topup@studio.test");
  const created = await createPayment(db, {
    userId,
    purpose: "credit_topup",
    packageId: "pack_1200",
    credits: 1300,
    priceUsdCents: 1000,
  });
  const payment = (await getPayment(db, created.payment.id))!;
  const result = await applyGatewayResult(db, payment, {
    status: "completed",
    receipt: "RCPT-TOPUP",
    amountKes: 1300,
    raw: {},
    source: "status_poll",
  });
  assert.equal(result.payment.status, "completed");
  const wallet = await getWallet(db, userId);
  assert.equal(wallet.balance, 1300);
  assert.equal(wallet.lifetimePurchased, 1300);
  const grant = await db.first<{ expires_at: number | null; source: string }>(
    `SELECT expires_at, source FROM credit_grants WHERE user_id = ?`,
    [userId],
  );
  assert.equal(grant?.expires_at, null);
  assert.equal(grant?.source, "purchase");
});

test("payment events are deduplicated by event key", async () => {
  const db = createTestDb();
  const first = await recordPaymentEvent(db, {
    paymentId: null,
    eventKey: "wh:payment.completed:ws_CO_1:completed:R1",
    eventType: "payment.completed",
    payload: {},
    signatureValid: true,
  });
  const duplicate = await recordPaymentEvent(db, {
    paymentId: null,
    eventKey: "wh:payment.completed:ws_CO_1:completed:R1",
    eventType: "payment.completed",
    payload: {},
    signatureValid: true,
  });
  assert.equal(first, true);
  assert.equal(duplicate, false);
});

test("a pending payment is not fulfilled by a browser-style status guess", async () => {
  const db = createTestDb();
  const userId = await createUser(db, "pending@studio.test");
  const created = await createPayment(db, {
    userId,
    purpose: "subscription",
    planId: "plan_starter",
    credits: 1000,
    priceUsdCents: 1000,
  });
  const payment = (await getPayment(db, created.payment.id))!;
  const result = await applyGatewayResult(db, payment, {
    status: "pending",
    receipt: null,
    amountKes: null,
    raw: {},
    source: "status_poll",
  });
  assert.equal(result.applied, false);
  assert.equal((await getPayment(db, created.payment.id))?.status, "pending");
  assert.equal((await getWallet(db, userId)).balance, 0);
});

test("payment views expose customer-safe fields only", async () => {
  const db = createTestDb();
  const userId = await createUser(db, "view@studio.test");
  const created = await createPayment(db, {
    userId,
    purpose: "subscription",
    planId: "plan_starter",
    credits: 1000,
    priceUsdCents: 1000,
  });
  const view = paymentView(created.payment);
  assert.equal(view.amountKes, 1300);
  assert.equal(view.priceUsd, 10);
  assert.equal(view.status, "pending");
  assert.ok(!("metadata" in view));
  assert.ok(!("user_id" in view));
});

test("gateway calls refuse to run without configuration", async () => {
  await assert.rejects(
    initiateStkPush({ apiKey: "" }, {
      phoneNumber: "0712345678",
      amountKes: 100,
      accountReference: "XDG-1",
      transactionDesc: "Test",
    }),
  );
  await assert.rejects(fetchPaymentStatus({ apiKey: "" }, "ws_CO_1"));
});
