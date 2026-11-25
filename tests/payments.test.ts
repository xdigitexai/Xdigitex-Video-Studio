import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, id } from "./helpers/test-db";
import {
  applyGatewayResult,
  assertPaymentOwner,
  createPayment,
  getPayment,
  paymentView,
  recordPaymentEvent,
} from "../lib/server/payments/service";
import {
  fetchPaymentStatus,
  initiatePayment,
  normaliseInternationalPhone,
  normaliseKenyanPhone,
  signWebhookBody,
  verifyWebhookSignature,
} from "../lib/server/payments/xdigitex";
import { detectPaymentNumber, formatLocalMoney, rateForCurrency } from "../lib/payment-countries";
import { getWallet } from "../lib/server/credits";
import { latestSubscription } from "../lib/server/plans";
import { listPayments } from "../lib/server/payments/service";

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

test("phone detection derives country, network and currency for supported prefixes", () => {
  const kenya = detectPaymentNumber("0712 345 678");
  assert.equal(kenya?.dialCode, "+254");
  assert.equal(kenya?.currency, "KES");
  assert.equal(kenya?.networks[0], "M-Pesa (Safaricom)");
  assert.equal(kenya?.internationalNumber, "+254712345678");

  const drc = detectPaymentNumber("+243 81 234 5678");
  assert.equal(drc?.country, "DR Congo");
  assert.equal(drc?.currency, "CDF");
  assert.equal(drc?.internationalNumber, "+243812345678");

  const uganda = detectPaymentNumber("00256712345678");
  assert.equal(uganda?.currency, "UGX");
  assert.equal(uganda?.networks.includes("MTN Uganda"), true);
  assert.equal(detectPaymentNumber("+9991234567"), null);
});

test("international normalisation accepts both local and country-code formats", () => {
  assert.equal(normaliseInternationalPhone("0712345678"), "+254712345678");
  assert.equal(normaliseInternationalPhone("+254712345678"), "+254712345678");
  assert.equal(normaliseInternationalPhone("256712345678"), "+256712345678");
  assert.equal(normaliseInternationalPhone("12345"), null);
  assert.equal(normaliseKenyanPhone("0112345678"), "254112345678");
  assert.equal(normaliseKenyanPhone("+256712345678"), null);
});

test("local money formatting and rates use admin KES setting only for KES", () => {
  assert.equal(rateForCurrency("KES", 137.5), 137.5);
  assert.equal(rateForCurrency("UGX", 137.5), 3600);
  assert.equal(rateForCurrency("USD", 137.5), 1);
  assert.match(formatLocalMoney(1300, "KES"), /KES/);
});

test("webhook signatures are HMAC-SHA256 over the raw body", async () => {
  const body = JSON.stringify({ event: "payment.completed", reference: "XDG-TEST" });
  const signature = await signWebhookBody("whsec_test", body);
  assert.match(signature, /^sha256=[0-9a-f]{64}$/);
  assert.equal(await verifyWebhookSignature("whsec_test", body, signature), true);
  assert.equal(await verifyWebhookSignature("whsec_test", body, `sha256=${"0".repeat(64)}`), false);
  assert.equal(await verifyWebhookSignature("whsec_test", `${body} `, signature), false);
  assert.equal(await verifyWebhookSignature("", body, signature), false);
});

test("payments are priced in the detected local currency", async () => {
  const db = createTestDb();
  const userId = await createUser(db, "currency@studio.test");
  const local = await createPayment(db, {
    userId,
    purpose: "credit_topup",
    packageId: "pack_500",
    credits: 500,
    priceUsdCents: 500,
    currency: "UGX",
    localAmount: 18_000,
  });
  assert.equal(local.payment.currency, "UGX");
  assert.equal(local.amountLocal, 18_000);
  assert.equal(local.payment.amount_minor, 1_800_000);

  const kes = await createPayment(db, {
    userId,
    purpose: "subscription",
    planId: "plan_starter",
    credits: 1000,
    priceUsdCents: 1000,
    currency: "KES",
  });
  assert.equal(kes.amountLocal, 1300);
  assert.equal(kes.payment.amount_minor, 130_000);
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
  assert.equal(created.payment.amount_minor, 130_000);
  await db.run(`UPDATE payments SET provider_checkout_id = ? WHERE id = ?`, ["XDG-TEST-1", created.payment.id]);

  const payment = (await getPayment(db, created.payment.id))!;
  const result = await applyGatewayResult(db, payment, {
    status: "completed",
    receipt: "RCPT-1",
    amountLocal: 1300,
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
    amountLocal: 1300,
    raw: {},
    source: "status_poll",
  });
  assert.equal(replay.alreadyCompleted, true);
  assert.equal((await getWallet(db, userId)).balance, 1000, "replay must not grant credits twice");

  const grants = await db.all<{ count: number }>(`SELECT COUNT(*) AS count FROM credit_grants WHERE user_id = ?`, [userId]);
  assert.equal(grants[0].count, 1);
});

test("a currency or amount mismatch fails the payment and allocates nothing", async () => {
  const db = createTestDb();
  const userId = await createUser(db, "mismatch@studio.test");
  const created = await createPayment(db, {
    userId,
    purpose: "subscription",
    planId: "plan_starter",
    credits: 1000,
    priceUsdCents: 1000,
  });
  const result = await applyGatewayResult(db, (await getPayment(db, created.payment.id))!, {
    status: "completed",
    receipt: "RCPT-2",
    amountLocal: 1300,
    currency: "UGX",
    raw: {},
    source: "webhook",
  });
  assert.equal(result.applied, false);
  assert.match(result.error ?? "", /amount_mismatch/);
  assert.equal((await getPayment(db, created.payment.id))?.status, "failed");
  assert.equal((await getWallet(db, userId)).balance, 0);
  assert.equal(await latestSubscription(db, userId), null);
});

test("a reused gateway receipt is rejected", async () => {
  const db = createTestDb();
  const userId = await createUser(db, "receipt@studio.test");
  const first = await createPayment(db, {
    userId,
    purpose: "subscription",
    planId: "plan_starter",
    credits: 1000,
    priceUsdCents: 1000,
  });
  await applyGatewayResult(db, (await getPayment(db, first.payment.id))!, {
    status: "completed",
    receipt: "RCPT-DUP",
    amountLocal: 1300,
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
  const result = await applyGatewayResult(db, (await getPayment(db, second.payment.id))!, {
    status: "completed",
    receipt: "RCPT-DUP",
    amountLocal: 650,
    raw: {},
    source: "webhook",
  });
  assert.equal(result.applied, false);
  assert.match(result.error ?? "", /duplicate_receipt/);
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
  const result = await applyGatewayResult(db, (await getPayment(db, created.payment.id))!, {
    status: "completed",
    receipt: "RCPT-TOPUP",
    amountLocal: 1300,
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
    eventKey: "wh:payment.completed:XDG-TEST:completed:R1",
    eventType: "payment.completed",
    payload: {},
    signatureValid: true,
  });
  const duplicate = await recordPaymentEvent(db, {
    paymentId: null,
    eventKey: "wh:payment.completed:XDG-TEST:completed:R1",
    eventType: "payment.completed",
    payload: {},
    signatureValid: true,
  });
  assert.equal(first, true);
  assert.equal(duplicate, false);
});

test("a pending gateway status never fulfils a payment", async () => {
  const db = createTestDb();
  const userId = await createUser(db, "pending@studio.test");
  const created = await createPayment(db, {
    userId,
    purpose: "subscription",
    planId: "plan_starter",
    credits: 1000,
    priceUsdCents: 1000,
  });
  const result = await applyGatewayResult(db, (await getPayment(db, created.payment.id))!, {
    status: "pending",
    receipt: null,
    amountLocal: null,
    raw: {},
    source: "status_poll",
  });
  assert.equal(result.applied, false);
  assert.equal((await getPayment(db, created.payment.id))?.status, "pending");
  assert.equal((await getWallet(db, userId)).balance, 0);
});

test("customers cannot read another customer's payment", async () => {
  const db = createTestDb();
  const owner = await createUser(db, "owner@studio.test");
  const other = await createUser(db, "other@studio.test");
  const created = await createPayment(db, {
    userId: owner,
    purpose: "credit_topup",
    packageId: "pack_500",
    credits: 500,
    priceUsdCents: 500,
  });
  assert.throws(() => assertPaymentOwner(created.payment, other), (error: unknown) => {
    const apiError = error as { code?: string; status?: number };
    return apiError.code === "PAYMENT_NOT_FOUND" && apiError.status === 404;
  });
  assert.equal((await listPayments(db, { userId: other })).length, 0);
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
  assert.equal(view.amountLocal, 1300);
  assert.equal(view.priceUsd, 10);
  assert.equal(view.status, "pending");
  assert.ok(!("metadata" in view));
  assert.ok(!("user_id" in view));
});

test("gateway calls refuse to run without configuration and reject crypto", async () => {
  await assert.rejects(
    initiatePayment({ apiKey: "" }, {
      gateway: "mobile",
      amount: 100,
      currency: "KES",
      phone: "+254712345678",
      description: "Test",
    }),
  );
  await assert.rejects(fetchPaymentStatus({ apiKey: "" }, "XDG-TEST"));
  await assert.rejects(
    initiatePayment({ apiKey: "test" }, {
      // Deliberately outside the allowed union to prove the adapter gate exists.
      ...({ gateway: "crypto" } as unknown as { gateway: "mobile" }),
      amount: 100,
      currency: "KES",
      phone: "+254712345678",
      description: "Test",
    }),
  );
});
