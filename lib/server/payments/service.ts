import type { Db } from "../db";
import { ApiError } from "../http";
import { newReference, newId, now, parseJson, DAY } from "../util";
import { getPlan, activatePlan, getSubscriptionById, type PlanRow } from "../plans";
import { grantCredits } from "../credits";

import { recordAudit } from "../audit";
import {
  fetchPaymentStatus,
  initiateStkPush,
  type GatewayPaymentStatus,
  type XdigitexConfig,
} from "./xdigitex";
import { getPricingSettings } from "../settings";

export interface PaymentRow {
  id: string;
  user_id: string;
  reference: string;
  purpose: string;
  provider: string;
  plan_id: string | null;
  package_id: string | null;
  subscription_id: string | null;
  amount_minor: number;
  currency: string;
  price_usd_cents: number;
  credits: number;
  status: string;
  provider_checkout_id: string | null;
  provider_receipt: string | null;
  phone_number: string | null;
  failure_reason: string | null;
  fulfillment_error: string | null;
  metadata: string;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  refunded_at: number | null;
}

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending: "Awaiting payment",
  processing: "Processing",
  completed: "Paid",
  failed: "Failed",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export async function getPayment(db: Db, id: string): Promise<PaymentRow | null> {
  return db.first<PaymentRow>(`SELECT * FROM payments WHERE id = ?`, [id]);
}

export async function listPayments(
  db: Db,
  options: { userId?: string; status?: string; limit?: number; offset?: number; since?: number; until?: number } = {},
): Promise<PaymentRow[]> {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (options.userId) {
    clauses.push("user_id = ?");
    params.push(options.userId);
  }
  if (options.status) {
    clauses.push("status = ?");
    params.push(options.status);
  }
  if (options.since) {
    clauses.push("created_at >= ?");
    params.push(options.since);
  }
  if (options.until) {
    clauses.push("created_at <= ?");
    params.push(options.until);
  }
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);
  return db.all<PaymentRow>(
    `SELECT * FROM payments ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
}

export interface CreatePaymentInput {
  userId: string;
  purpose: "subscription" | "subscription_renewal" | "plan_change" | "credit_topup";
  planId?: string | null;
  packageId?: string | null;
  credits: number;
  priceUsdCents: number;
  metadata?: Record<string, unknown>;
  subscriptionId?: string | null;
}

export interface CreatedPayment {
  payment: PaymentRow;
  reused: boolean;
  amountKes: number;
}

export async function createPayment(db: Db, input: CreatePaymentInput): Promise<CreatedPayment> {
  const settings = await getPricingSettings(db);
  const amountKes = Math.max(
    1,
    Math.round((input.priceUsdCents / 100) * (settings.usd_to_kes_rate_micros / 1_000_000)),
  );
  const recent = await db.first<PaymentRow>(
    `SELECT * FROM payments
     WHERE user_id = ? AND status = 'pending' AND purpose = ?
       AND COALESCE(plan_id, '') = COALESCE(?, '') AND COALESCE(package_id, '') = COALESCE(?, '')
       AND created_at > ?
     ORDER BY created_at DESC LIMIT 1`,
    [input.userId, input.purpose, input.planId ?? null, input.packageId ?? null, now() - 2 * 60_000],
  );
  if (recent && recent.amount_minor === amountKes * 100) {
    return { payment: recent, reused: true, amountKes };
  }
  const timestamp = now();
  const payment: PaymentRow = {
    id: newId("pay"),
    user_id: input.userId,
    reference: newReference("XDG"),
    purpose: input.purpose,
    provider: "xdigitex_pay",
    plan_id: input.planId ?? null,
    package_id: input.packageId ?? null,
    subscription_id: input.subscriptionId ?? null,
    amount_minor: amountKes * 100,
    currency: "KES",
    price_usd_cents: input.priceUsdCents,
    credits: input.credits,
    status: "pending",
    provider_checkout_id: null,
    provider_receipt: null,
    phone_number: null,
    failure_reason: null,
    fulfillment_error: null,
    metadata: JSON.stringify(input.metadata ?? {}),
    created_at: timestamp,
    updated_at: timestamp,
    completed_at: null,
    refunded_at: null,
  };
  await db.run(
    `INSERT INTO payments (id, user_id, reference, purpose, provider, plan_id, package_id, subscription_id,
       amount_minor, currency, price_usd_cents, credits, status, provider_checkout_id, provider_receipt,
       phone_number, failure_reason, fulfillment_error, metadata, created_at, updated_at, completed_at, refunded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, NULL, ?, ?, ?, NULL, NULL)`,
    [
      payment.id,
      payment.user_id,
      payment.reference,
      payment.purpose,
      payment.provider,
      payment.plan_id,
      payment.package_id,
      payment.subscription_id,
      payment.amount_minor,
      payment.currency,
      payment.price_usd_cents,
      payment.credits,
      payment.metadata,
      payment.created_at,
      payment.updated_at,
    ],
  );
  return { payment, reused: false, amountKes };
}

export interface CheckoutInput {
  payment: PaymentRow;
  phoneNumber: string;
  description: string;
  config: XdigitexConfig | null;
  baseUrl?: string;
}

export interface CheckoutResult {
  payment: PaymentRow;
  checkoutRequestId: string;
  message: string;
}

/**
 * Starts the STK push. A browser redirect or a success page is never treated as
 * proof of payment; only a verified gateway status/webhook completes the order.
 */
export async function startCheckout(db: Db, input: CheckoutInput): Promise<CheckoutResult> {
  if (!input.config) {
    throw new ApiError(
      503,
      "Card and M-Pesa payments are not configured. Add the Pay Xdigitex API key.",
      "PAYMENT_NOT_CONFIGURED",
    );
  }
  if (input.payment.status !== "pending") {
    throw new ApiError(409, "This payment can no longer be started.", "PAYMENT_NOT_PENDING");
  }
  if (input.payment.provider_checkout_id) {
    return {
      payment: input.payment,
      checkoutRequestId: input.payment.provider_checkout_id,
      message: "Waiting for you to approve the payment prompt on your phone.",
    };
  }
  const amountKes = Math.round(input.payment.amount_minor / 100);
  try {
    const result = await initiateStkPush(input.config, {
      phoneNumber: input.phoneNumber,
      amountKes,
      accountReference: input.payment.reference,
      transactionDesc: input.description.slice(0, 100),
    });
    const timestamp = now();
    await db.run(
      `UPDATE payments SET provider_checkout_id = ?, phone_number = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
      [result.checkoutRequestId, input.phoneNumber, timestamp, input.payment.id],
    );
    const payment = (await getPayment(db, input.payment.id))!;
    return {
      payment,
      checkoutRequestId: result.checkoutRequestId,
      message: "Approve the M-Pesa prompt on your phone to complete the payment.",
    };
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    if (status >= 400 && status < 500) {
      await db.run(
        `UPDATE payments SET status = 'failed', failure_reason = ?, updated_at = ? WHERE id = ?`,
        [(error as Error).message.slice(0, 300), now(), input.payment.id],
      );
    }
    throw error;
  }
}

export interface FulfillmentResult {
  payment: PaymentRow;
  applied: boolean;
  alreadyCompleted: boolean;
  error?: string;
}

function mergeMetadata(raw: string, patch: Record<string, unknown>): string {
  return JSON.stringify({ ...parseJson<Record<string, unknown>>(raw, {}), ...patch });
}

export async function recordPaymentEvent(
  db: Db,
  input: {
    paymentId: string | null;
    eventKey: string;
    eventType: string;
    payload: unknown;
    signatureValid: boolean;
  },
): Promise<boolean> {
  try {
    const result = await db.run(
      `INSERT OR IGNORE INTO payment_events (id, payment_id, event_key, event_type, payload, signature_valid, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        newId("pev"),
        input.paymentId,
        input.eventKey.slice(0, 200),
        input.eventType.slice(0, 80),
        JSON.stringify(input.payload).slice(0, 20_000),
        input.signatureValid ? 1 : 0,
        now(),
      ],
    );
    return result.changes > 0;
  } catch (error) {
    console.error("[payments] failed to record payment event", error);
    return false;
  }
}

/**
 * Applies a verified gateway result. Amount mismatches and duplicate receipts are
 * rejected before any credit can be granted.
 */
export async function applyGatewayResult(
  db: Db,
  payment: PaymentRow,
  result: {
    status: GatewayPaymentStatus;
    receipt: string | null;
    amountKes: number | null;
    raw: unknown;
    source: "webhook" | "status_poll" | "admin";
  },
): Promise<FulfillmentResult> {
  if (payment.status === "completed") {
    return { payment, applied: false, alreadyCompleted: true };
  }
  if (payment.status === "refunded") {
    return { payment, applied: false, alreadyCompleted: true, error: "Payment was refunded." };
  }
  const expectedKes = Math.round(payment.amount_minor / 100);
  if (result.status === "completed") {
    if (result.amountKes !== null && Math.abs(result.amountKes - expectedKes) >= 1) {
      const reason = `amount_mismatch: expected ${expectedKes} KES, received ${result.amountKes} KES`;
      await db.run(
        `UPDATE payments SET status = 'failed', failure_reason = ?, updated_at = ? WHERE id = ? AND status != 'completed'`,
        [reason, now(), payment.id],
      );
      await recordAudit(db, {
        action: "payment.amount_mismatch",
        targetType: "payment",
        targetId: payment.id,
        metadata: { expectedKes, receivedKes: result.amountKes },
      });
      return { payment: (await getPayment(db, payment.id))!, applied: false, alreadyCompleted: false, error: reason };
    }
    if (result.receipt) {
      const duplicate = await db.first<{ id: string }>(
        `SELECT id FROM payments WHERE provider_receipt = ? AND id != ? AND status = 'completed' LIMIT 1`,
        [result.receipt, payment.id],
      );
      if (duplicate) {
        const reason = `duplicate_receipt:${result.receipt}`;
        await db.run(
          `UPDATE payments SET status = 'failed', failure_reason = ?, updated_at = ? WHERE id = ? AND status != 'completed'`,
          [reason, now(), payment.id],
        );
        return { payment: (await getPayment(db, payment.id))!, applied: false, alreadyCompleted: false, error: reason };
      }
    }
    return fulfillPayment(db, payment.id, { receipt: result.receipt, raw: result.raw, source: result.source });
  }

  if (result.status === "failed" || result.status === "cancelled") {
    const next = result.status === "failed" ? "failed" : "cancelled";
    await db.run(
      `UPDATE payments SET status = ?, failure_reason = ?, provider_receipt = COALESCE(provider_receipt, ?), updated_at = ?
       WHERE id = ? AND status IN ('pending','processing')`,
      [next, `gateway_${result.status}`, result.receipt, now(), payment.id],
    );
    const updated = (await getPayment(db, payment.id))!;
    return { payment: updated, applied: false, alreadyCompleted: false };
  }
  return { payment, applied: false, alreadyCompleted: false };
}

export async function fulfillPayment(
  db: Db,
  paymentId: string,
  evidence: { receipt: string | null; raw: unknown; source: string },
): Promise<FulfillmentResult> {
  const payment = await getPayment(db, paymentId);
  if (!payment) throw new ApiError(404, "Payment not found.", "PAYMENT_NOT_FOUND");
  if (payment.status === "completed") {
    return { payment, applied: false, alreadyCompleted: true };
  }
  // Claim exactly once. A concurrent webhook + status poll cannot both fulfil.
  const claim = await db.run(
    `UPDATE payments SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'pending'`,
    [now(), payment.id],
  );
  if (claim.changes !== 1) {
    const current = (await getPayment(db, payment.id))!;
    if (current.status === "completed") return { payment: current, applied: false, alreadyCompleted: true };
    return { payment: current, applied: false, alreadyCompleted: false, error: "Payment is being processed." };
  }

  try {
    let subscriptionId = payment.subscription_id;
    let metadataPatch: Record<string, unknown> = { evidenceSource: evidence.source };

    if (payment.purpose === "credit_topup") {
      const granted = await grantCredits(db, {
        userId: payment.user_id,
        credits: payment.credits,
        source: "purchase",
        sourceId: payment.package_id ?? "",
        reference: `payment:${payment.id}:credits`,
        description: "Credit top-up",
        paymentId: payment.id,
        bumpLifetime: "purchased",
      });
      metadataPatch = { ...metadataPatch, creditsGranted: payment.credits, creditsApplied: granted };
    } else {
      const plan = payment.plan_id ? await getPlan(db, payment.plan_id) : null;
      if (!plan) throw new Error("The plan for this payment no longer exists.");
      const meta = parseJson<Record<string, unknown>>(payment.metadata, {});
      let periodEnd: number;
      if (meta.activatedAt) {
        periodEnd = Number(meta.periodEnd) || now();
        subscriptionId = (typeof meta.subscriptionId === "string" ? meta.subscriptionId : null) ?? subscriptionId;
      } else {
        const activation = await activatePlan(db, {
          userId: payment.user_id,
          planId: plan.id,
          paymentId: payment.id,
          months: plan.interval_months,
        });
        subscriptionId = activation.subscription.id;
        periodEnd = activation.periodEnd;
        metadataPatch = {
          ...metadataPatch,
          activatedAt: now(),
          periodStart: activation.periodStart,
          periodEnd,
          subscriptionId,
          planId: plan.id,
        };
        await db.run(
          `UPDATE payments SET subscription_id = ?, metadata = ?, updated_at = ? WHERE id = ?`,
          [subscriptionId, mergeMetadata(payment.metadata, metadataPatch), now(), payment.id],
        );
      }
      const granted = await grantCredits(db, {
        userId: payment.user_id,
        credits: plan.credits_per_period,
        source: "subscription",
        sourceId: subscriptionId ?? "",
        reference: `payment:${payment.id}:credits`,
        description: `${plan.name} subscription credits`,
        expiresAt: periodEnd + 30 * DAY,
        paymentId: payment.id,
        bumpLifetime: "granted",
      });
      metadataPatch = { ...metadataPatch, creditsGranted: plan.credits_per_period, creditsApplied: granted };
    }

    const timestamp = now();
    await db.run(
      `UPDATE payments
       SET status = 'completed', provider_receipt = COALESCE(?, provider_receipt), completed_at = ?,
           updated_at = ?, fulfillment_error = NULL, failure_reason = NULL, metadata = ?
       WHERE id = ? AND status = 'processing'`,
      [evidence.receipt, timestamp, timestamp, mergeMetadata(payment.metadata, metadataPatch), payment.id],
    );
    const completed = (await getPayment(db, payment.id))!;
    return { payment: completed, applied: true, alreadyCompleted: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fulfilment failed.";
    await db.run(
      `UPDATE payments SET status = 'pending', fulfillment_error = ?, updated_at = ? WHERE id = ? AND status = 'processing'`,
      [message.slice(0, 500), now(), payment.id],
    );
    console.error("[payments] fulfilment failed", payment.id, message);
    return {
      payment: (await getPayment(db, payment.id))!,
      applied: false,
      alreadyCompleted: false,
      error: message,
    };
  }
}

export async function pollPayment(
  db: Db,
  paymentId: string,
  config: XdigitexConfig | null,
): Promise<FulfillmentResult> {
  const payment = await getPayment(db, paymentId);
  if (!payment) throw new ApiError(404, "Payment not found.", "PAYMENT_NOT_FOUND");
  if (payment.status !== "pending" && payment.status !== "processing") {
    return { payment, applied: false, alreadyCompleted: payment.status === "completed" };
  }
  if (!payment.provider_checkout_id || !config) {
    return { payment, applied: false, alreadyCompleted: false };
  }
  const status = await fetchPaymentStatus(config, payment.provider_checkout_id);
  const eventKey = `status:${payment.id}:${status.status}:${status.receipt ?? ""}`;
  await recordPaymentEvent(db, {
    paymentId: payment.id,
    eventKey,
    eventType: `payment.${status.status}`,
    payload: status.raw,
    signatureValid: false,
  });
  return applyGatewayResult(db, payment, {
    status: status.status,
    receipt: status.receipt,
    amountKes: status.amountKes,
    raw: status.raw,
    source: "status_poll",
  });
}

/** Admin reconciliation: retries pending gateway checks and incomplete fulfilment. */
export async function reconcilePayments(
  db: Db,
  config: XdigitexConfig | null,
  limit = 30,
): Promise<{ checked: number; completed: number; stillPending: number; failed: number }> {
  const candidates = await db.all<PaymentRow>(
    `SELECT * FROM payments
     WHERE status = 'pending' AND created_at > ? AND (provider_checkout_id IS NOT NULL OR fulfillment_error IS NOT NULL)
     ORDER BY created_at ASC LIMIT ?`,
    [now() - 7 * DAY, limit],
  );
  let completed = 0;
  let stillPending = 0;
  let failed = 0;
  for (const payment of candidates) {
    if (!payment.provider_checkout_id || !config) {
      stillPending += 1;
      continue;
    }
    try {
      const result = await pollPayment(db, payment.id, config);
      if (result.payment.status === "completed") completed += 1;
      else if (result.payment.status === "failed" || result.payment.status === "cancelled") failed += 1;
      else stillPending += 1;
    } catch {
      stillPending += 1;
    }
  }
  return { checked: candidates.length, completed, stillPending, failed };
}

export async function refundPayment(
  db: Db,
  paymentId: string,
  actor: { id: string; email: string },
  reason: string,
): Promise<{ refunded: boolean; clawedBack: number; shortfall: number }> {
  const payment = await getPayment(db, paymentId);
  if (!payment) throw new ApiError(404, "Payment not found.", "PAYMENT_NOT_FOUND");
  if (payment.status !== "completed") {
    throw new ApiError(409, "Only completed payments can be refunded.", "PAYMENT_NOT_COMPLETED");
  }
  const mark = await db.run(
    `UPDATE payments SET status = 'refunded', refunded_at = ?, updated_at = ?, metadata = ? WHERE id = ? AND status = 'completed'`,
    [now(), now(), mergeMetadata(payment.metadata, { refundReason: reason, refundedBy: actor.email }), payment.id],
  );
  if (mark.changes !== 1) throw new ApiError(409, "Payment could not be refunded.", "REFUND_FAILED");
  const { adjustCredits } = await import("../credits");
  const clawed = await adjustCredits(db, {
    userId: payment.user_id,
    credits: -payment.credits,
    reference: `payment:${payment.id}:refund`,
    description: `Refund of ${payment.reference}`,
    actorId: actor.id,
  });
  await recordAudit(db, {
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: "payment.refunded",
    targetType: "payment",
    targetId: payment.id,
    metadata: { reason, credits: payment.credits, clawedBack: clawed },
  });
  return { refunded: true, clawedBack: clawed ? payment.credits : 0, shortfall: clawed ? 0 : payment.credits };
}

export function paymentAmountKes(payment: PaymentRow): number {
  return Math.round(payment.amount_minor / 100);
}

export function paymentPlan(db: Db, payment: PaymentRow): Promise<PlanRow | null> {
  return payment.plan_id ? getPlan(db, payment.plan_id) : Promise.resolve(null);
}

export async function paymentSubscription(db: Db, payment: PaymentRow) {
  return payment.subscription_id ? getSubscriptionById(db, payment.subscription_id) : null;
}


/** Customer-safe payment shape. */
export function paymentView(payment: PaymentRow) {
  return {
    id: payment.id,
    reference: payment.reference,
    purpose: payment.purpose,
    status: payment.status,
    amountKes: Math.round(payment.amount_minor / 100),
    priceUsd: payment.price_usd_cents / 100,
    credits: payment.credits,
    planId: payment.plan_id,
    packageId: payment.package_id,
    receipt: payment.provider_receipt,
    failureReason: payment.failure_reason,
    createdAt: payment.created_at,
    completedAt: payment.completed_at,
    refundedAt: payment.refunded_at,
  };
}
