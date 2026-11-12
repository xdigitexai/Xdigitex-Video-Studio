/**
 * Pay Xdigitex client.
 *
 * Contract taken from the official documentation at https://pay.xdigitex.com/docs:
 *  - Base URL: https://pay.xdigitex.com (configurable)
 *  - Auth: X-API-Key
 *  - POST /api/payments/stkpush  { phoneNumber, amount, accountReference, transactionDesc }
 *  - GET  /api/payments/status/:checkoutRequestId
 *  - Webhook: X-Webhook-Event, X-Webhook-Timestamp,
 *             X-Webhook-Signature: sha256=<hex HMAC-SHA256 of the raw body>
 * The documented currency is KES (M-Pesa); amounts are whole KES.
 */

import { hmacSha256Hex, verifyHmacSha256 } from "../crypto";

export interface XdigitexConfig {
  apiKey: string;
  baseUrl?: string;
  webhookSecret?: string;
  sandbox?: boolean;
}

export const DEFAULT_PAY_BASE_URL = "https://pay.xdigitex.com";

export class PaymentGatewayError extends Error {
  status: number;
  code: string;
  detail: string;

  constructor(status: number, message: string, detail = "", code = "PAYMENT_GATEWAY_ERROR") {
    super(message);
    this.status = status;
    this.detail = detail;
    this.code = code;
  }
}

function baseUrl(config: XdigitexConfig): string {
  return (config.baseUrl || DEFAULT_PAY_BASE_URL).replace(/\/+$/, "");
}

/** Normalises Kenyan mobile numbers to 2547XXXXXXXX / 2541XXXXXXXX. */
export function normaliseKenyanPhone(input: string): string | null {
  const digits = String(input || "").replace(/\D/g, "");
  if (/^254(7|1)\d{8}$/.test(digits)) return digits;
  if (/^0(7|1)\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^(7|1)\d{8}$/.test(digits)) return `254${digits}`;
  return null;
}

export interface StkPushInput {
  phoneNumber: string;
  amountKes: number;
  accountReference: string;
  transactionDesc: string;
  tenantCode?: string;
}

export interface StkPushResult {
  checkoutRequestId: string;
  raw: Record<string, unknown>;
}

export async function initiateStkPush(
  config: XdigitexConfig,
  input: StkPushInput,
): Promise<StkPushResult> {
  if (!config.apiKey) {
    throw new PaymentGatewayError(503, "Payment gateway is not configured.", "", "PAYMENT_NOT_CONFIGURED");
  }
  const phone = normaliseKenyanPhone(input.phoneNumber);
  if (!phone) {
    throw new PaymentGatewayError(400, "Enter a valid Kenyan M-Pesa number (07XX XXX XXX).", "", "INVALID_PHONE");
  }
  if (!Number.isInteger(input.amountKes) || input.amountKes < 1) {
    throw new PaymentGatewayError(400, "Payment amount must be at least 1 KES.", "", "INVALID_AMOUNT");
  }
  let response: Response;
  try {
    response = await fetch(`${baseUrl(config)}/api/payments/stkpush`, {
      method: "POST",
      headers: {
        "X-API-Key": config.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        phoneNumber: phone,
        amount: input.amountKes,
        accountReference: input.accountReference,
        transactionDesc: input.transactionDesc,
        ...(input.tenantCode ? { tenantCode: input.tenantCode } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new PaymentGatewayError(
      504,
      "The payment gateway could not be reached. Try again.",
      error instanceof Error ? error.message : "Network error",
      "PAYMENT_UNREACHABLE",
    );
  }
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    payload = { message: text.slice(0, 400) };
  }
  if (!response.ok) {
    const message =
      (typeof payload.message === "string" && payload.message) ||
      (typeof payload.error === "string" && payload.error) ||
      `Payment gateway rejected the request (${response.status}).`;
    throw new PaymentGatewayError(
      response.status === 401 || response.status === 403 ? 502 : response.status,
      message,
      JSON.stringify(payload).slice(0, 500),
      typeof payload.error === "string" ? payload.error : "PAYMENT_REJECTED",
    );
  }
  const checkoutRequestId =
    (typeof payload.checkoutRequestId === "string" && payload.checkoutRequestId) ||
    (typeof payload.CheckoutRequestID === "string" && payload.CheckoutRequestID) ||
    "";
  if (!checkoutRequestId) {
    throw new PaymentGatewayError(
      502,
      "The payment gateway did not return a checkout reference.",
      JSON.stringify(payload).slice(0, 500),
      "PAYMENT_BAD_RESPONSE",
    );
  }
  return { checkoutRequestId, raw: payload };
}

export type GatewayPaymentStatus = "pending" | "completed" | "failed" | "cancelled";

export interface GatewayStatusResult {
  status: GatewayPaymentStatus;
  receipt: string | null;
  amountKes: number | null;
  raw: Record<string, unknown>;
}

export async function fetchPaymentStatus(
  config: XdigitexConfig,
  checkoutRequestId: string,
): Promise<GatewayStatusResult> {
  if (!config.apiKey) {
    throw new PaymentGatewayError(503, "Payment gateway is not configured.", "", "PAYMENT_NOT_CONFIGURED");
  }
  let response: Response;
  try {
    response = await fetch(
      `${baseUrl(config)}/api/payments/status/${encodeURIComponent(checkoutRequestId)}`,
      {
        headers: { "X-API-Key": config.apiKey },
        signal: AbortSignal.timeout(20_000),
      },
    );
  } catch (error) {
    throw new PaymentGatewayError(
      504,
      "Could not check the payment status.",
      error instanceof Error ? error.message : "Network error",
      "PAYMENT_UNREACHABLE",
    );
  }
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    payload = { message: text.slice(0, 400) };
  }
  if (!response.ok) {
    throw new PaymentGatewayError(
      response.status,
      typeof payload.message === "string" ? payload.message : `Status check failed (${response.status}).`,
      JSON.stringify(payload).slice(0, 400),
      "PAYMENT_STATUS_FAILED",
    );
  }
  const rawStatus = String(payload.status ?? "").toLowerCase();
  const status: GatewayPaymentStatus =
    rawStatus === "completed" || rawStatus === "success" || rawStatus === "succeeded"
      ? "completed"
      : rawStatus === "failed"
        ? "failed"
        : rawStatus === "cancelled" || rawStatus === "canceled"
          ? "cancelled"
          : "pending";
  const receipt =
    (typeof payload.mpesaReceiptNumber === "string" && payload.mpesaReceiptNumber) ||
    (typeof payload.mpesa_receipt_number === "string" && payload.mpesa_receipt_number) ||
    null;
  const amountRaw = payload.amount;
  const amountKes = amountRaw === undefined || amountRaw === null ? null : Number(amountRaw);
  return {
    status,
    receipt,
    amountKes: Number.isFinite(amountKes) ? amountKes : null,
    raw: payload,
  };
}

export async function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  if (!secret || !signature) return false;
  return verifyHmacSha256(secret, rawBody, signature);
}

export async function signWebhookBody(secret: string, rawBody: string): Promise<string> {
  return `sha256=${await hmacSha256Hex(secret, rawBody)}`;
}

export function paymentGatewayConfig(env: {
  XDIGITEX_PAY_API_KEY?: string;
  XDIGITEX_PAY_BASE_URL?: string;
  XDIGITEX_WEBHOOK_SECRET?: string;
  XDIGITEX_PAY_SANDBOX?: string;
}): XdigitexConfig | null {
  if (!env.XDIGITEX_PAY_API_KEY) return null;
  return {
    apiKey: env.XDIGITEX_PAY_API_KEY,
    baseUrl: env.XDIGITEX_PAY_BASE_URL,
    webhookSecret: env.XDIGITEX_WEBHOOK_SECRET,
    sandbox: env.XDIGITEX_PAY_SANDBOX === "true",
  };
}
