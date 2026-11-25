import { emailAlreadySent } from "@/lib/server/email";
import { emailConfig, trySendRenderedEmail } from "@/lib/server/email-notifications";
import {
  paymentFailedEmail,
  paymentSuccessfulEmail,
  subscriptionActivatedEmail,
} from "@/lib/server/email-templates";
import { getPlan } from "@/lib/server/plans";
import { applyGatewayResult, getPayment, recordPaymentEvent } from "@/lib/server/payments/service";
import { paymentGatewayConfig, verifyGatewaySettlement } from "@/lib/server/payments/xdigitex";
import { json } from "@/lib/server/http";
import { dbFromRequestEnv, runtimeEnv } from "@/lib/server/runtime";

export const dynamic = "force-dynamic";

/**
 * Pay Xdigitex server-to-server webhook.
 *
 * The gateway does not publish a webhook signature, so the POST body is only a
 * notification. Before any payment is fulfilled the reference is re-read from
 * the authenticated GET /payments/{reference}/status endpoint. Amount and
 * currency must match the stored record, and fulfillment is claim-once.
 */
export async function POST(request: Request) {
  const env = runtimeEnv();
  const db = dbFromRequestEnv();
  const config = paymentGatewayConfig(env);
  if (!config) {
    return json({ error: "Payment gateway is not configured.", code: "PAYMENT_NOT_CONFIGURED" }, 503);
  }

  const rawBody = await request.text();
  if (rawBody.length > 200_000) {
    return json({ error: "Payload too large.", code: "PAYLOAD_TOO_LARGE" }, 413);
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON.", code: "INVALID_JSON" }, 400);
  }

  const event =
    typeof payload.event === "string"
      ? payload.event
      : request.headers.get("x-webhook-event") || "payment.notification";
  const reference =
    (typeof payload.reference === "string" && payload.reference) ||
    (typeof payload.payment_reference === "string" && payload.payment_reference) ||
    "";
  if (!reference) {
    return json({ ok: true, unmatched: true });
  }
  if (!["payment.completed", "payment.failed"].includes(event)) {
    return json({ ok: true, ignored: true, event });
  }

  const payment = await db.first<Awaited<ReturnType<typeof getPayment>>>(
    `SELECT * FROM payments WHERE provider_checkout_id = ? ORDER BY created_at DESC LIMIT 1`,
    [reference],
  );
  if (!payment) {
    await recordPaymentEvent(db, {
      paymentId: null,
      eventKey: `wh:${event}:${reference}`,
      eventType: event,
      payload,
      signatureValid: false,
    });
    return json({ ok: true, unmatched: true });
  }

  const eventKey = `wh:${event}:${reference}:${payment.id}`;
  const inserted = await recordPaymentEvent(db, {
    paymentId: payment.id,
    eventKey,
    eventType: event,
    payload,
    signatureValid: true,
  });
  if (!inserted) {
    return json({ ok: true, duplicate: true });
  }

  let status;
  try {
    status = await verifyGatewaySettlement(
      config,
      reference,
      Math.round(payment.amount_minor / 100),
      payment.currency,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gateway verification failed.";
    return json({ error: message, code: "GATEWAY_VERIFICATION_FAILED" }, 502);
  }

  const expectedStatus = event === "payment.completed" ? "completed" : "failed";
  if (status.status !== expectedStatus) {
    return json({ ok: true, ignored: true, gatewayStatus: status.status });
  }

  const result = await applyGatewayResult(db, payment, {
    status: status.status,
    receipt: status.receipt,
    amountLocal: status.amount,
    currency: status.currency,
    raw: status.raw,
    source: "webhook",
  });

  const settled = result.payment;
  if (settled.status !== "completed" && settled.status !== "failed" && settled.status !== "cancelled") {
    return json({ ok: true, status: settled.status });
  }

  const user = await db.first<{ email: string; display_name: string }>(
    `SELECT email, display_name FROM users WHERE id = ? LIMIT 1`,
    [settled.user_id],
  );
  if (user) {
    const mailConfig = emailConfig(env, request);
    const plan = settled.plan_id ? await getPlan(db, settled.plan_id) : null;
    const siteUrl = env.APP_URL;
    const amount = settled.amount_minor / 100;
    const currency = settled.currency || "KES";

    if (
      settled.status === "completed" &&
      result.applied &&
      !(await emailAlreadySent(db, "payment_successful", settled.reference))
    ) {
      await trySendRenderedEmail(
        db,
        mailConfig,
        user.email,
        "payment_successful",
        paymentSuccessfulEmail({
          name: user.display_name,
          amount,
          currency,
          reference: settled.reference,
          receipt: settled.provider_receipt,
          purpose: settled.purpose,
          credits: settled.credits,
          siteUrl,
        }),
      );
    }

    if (
      settled.status === "completed" &&
      result.applied &&
      plan &&
      ["subscription", "subscription_renewal", "plan_change"].includes(settled.purpose) &&
      !(await emailAlreadySent(db, "subscription_activated", settled.reference))
    ) {
      await trySendRenderedEmail(
        db,
        mailConfig,
        user.email,
        "subscription_activated",
        subscriptionActivatedEmail({
          name: user.display_name,
          plan: plan.name,
          credits: settled.credits,
          siteUrl,
        }),
      );
    }

    if (
      (settled.status === "failed" || settled.status === "cancelled") &&
      !(await emailAlreadySent(db, "payment_failed", settled.reference))
    ) {
      await trySendRenderedEmail(
        db,
        mailConfig,
        user.email,
        "payment_failed",
        paymentFailedEmail({
          name: user.display_name,
          amount,
          currency,
          reference: settled.reference,
          reason: settled.failure_reason,
          siteUrl,
        }),
      );
    }
  }

  return json({ ok: true, status: settled.status, applied: result.applied });
}
