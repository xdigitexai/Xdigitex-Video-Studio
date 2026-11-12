import { dbFromRequestEnv, runtimeEnv } from "@/lib/server/runtime";
import { json } from "@/lib/server/http";
import { applyGatewayResult, getPayment, recordPaymentEvent } from "@/lib/server/payments/service";
import {
  paymentGatewayConfig,
  verifyWebhookSignature,
  type GatewayPaymentStatus,
} from "@/lib/server/payments/xdigitex";

export const dynamic = "force-dynamic";

/**
 * Pay Xdigitex server-to-server webhook.
 *
 * Security:
 *  - Raw-body HMAC-SHA256 verification with XDIGITEX_WEBHOOK_SECRET.
 *  - A signature failure returns 401 and never touches payment state.
 *  - Duplicate deliveries are de-duplicated by a stable event key.
 *  - Amount and receipt checks happen before credits are allocated.
 */
export async function POST(request: Request) {
  const env = runtimeEnv();
  const db = dbFromRequestEnv();
  const config = paymentGatewayConfig(env);
  if (!config?.webhookSecret) {
    return json({ error: "Webhook secret is not configured.", code: "WEBHOOK_NOT_CONFIGURED" }, 503);
  }
  const rawBody = await request.text();
  if (rawBody.length > 200_000) {
    return json({ error: "Payload too large.", code: "PAYLOAD_TOO_LARGE" }, 413);
  }
  const signature = request.headers.get("x-webhook-signature");
  const valid = await verifyWebhookSignature(config.webhookSecret, rawBody, signature);
  if (!valid) {
    await recordPaymentEvent(db, {
      paymentId: null,
      eventKey: `invalid:${Date.now()}:${crypto.randomUUID()}`,
      eventType: "webhook.signature_invalid",
      payload: { headerEvent: request.headers.get("x-webhook-event") },
      signatureValid: false,
    });
    return json({ error: "Invalid signature.", code: "INVALID_SIGNATURE" }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON.", code: "INVALID_JSON" }, 400);
  }
  const headerEvent = request.headers.get("x-webhook-event") || "";
  const event = typeof payload.event === "string" ? payload.event : headerEvent;
  const data = (payload.data && typeof payload.data === "object" ? payload.data : {}) as Record<string, unknown>;
  const checkoutRequestId = typeof data.checkoutRequestId === "string" ? data.checkoutRequestId : "";
  const rawStatus = String(data.status ?? "").toLowerCase();
  const status: GatewayPaymentStatus =
    event === "payment.completed" || rawStatus === "completed"
      ? "completed"
      : event === "payment.failed" || rawStatus === "failed"
        ? "failed"
        : event === "payment.cancelled" || event === "payment.canceled" || rawStatus === "cancelled"
          ? "cancelled"
          : "pending";
  const receipt = typeof data.mpesaReceiptNumber === "string" ? data.mpesaReceiptNumber : null;
  const eventKey = `wh:${event || "unknown"}:${checkoutRequestId}:${status}:${receipt ?? ""}`;

  const inserted = await recordPaymentEvent(db, {
    paymentId: null,
    eventKey,
    eventType: event || `payment.${status}`,
    payload,
    signatureValid: true,
  });
  if (!inserted) {
    return json({ ok: true, duplicate: true });
  }

  let payment = checkoutRequestId
    ? await db.first<Awaited<ReturnType<typeof getPayment>>>(
        `SELECT * FROM payments WHERE provider_checkout_id = ? ORDER BY created_at DESC LIMIT 1`,
        [checkoutRequestId],
      )
    : null;
  if (!payment && typeof data.accountReference === "string") {
    payment = await db.first<Awaited<ReturnType<typeof getPayment>>>(
      `SELECT * FROM payments WHERE reference = ? LIMIT 1`,
      [data.accountReference],
    );
  }
  if (!payment) {
    // Acknowledge so the gateway does not retry an orphan forever; admins can
    // inspect the recorded event and reconcile manually.
    return json({ ok: true, unmatched: true });
  }
  await db.run(`UPDATE payment_events SET payment_id = ? WHERE event_key = ? AND payment_id IS NULL`, [
    payment.id,
    eventKey,
  ]);

  const amountKes = data.amount === undefined || data.amount === null ? null : Number(data.amount);
  await applyGatewayResult(db, payment, {
    status,
    receipt,
    amountKes: Number.isFinite(amountKes) ? amountKes : null,
    raw: payload,
    source: "webhook",
  });
  return json({ ok: true });
}
