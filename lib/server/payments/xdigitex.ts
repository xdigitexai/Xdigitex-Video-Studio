/**
 * Pay Xdigitex client for https://pay.xdigitex.space.
 *
 * Contract from https://pay.xdigitex.space/docs:
 *  - Base URL: https://pay.xdigitex.space/api
 *  - Auth: X-API-Key (server-side only, never sent to the browser)
 *  - POST /payments/initiate  -> { reference, redirect_url?, message?, ... }
 *  - GET  /payments/{reference}/status -> { reference, status, amount, currency, ... }
 *  - Webhook events: payment.completed / payment.failed
 *
 * Only `card` and `mobile` gateways are allowed. `crypto` is intentionally not
 * exposed. Webhook payloads are never trusted for fulfillment: the reference is
 * re-checked with the authenticated status endpoint before credits are granted.
 */

import { detectPaymentNumber, type PaymentGateway } from "../../payment-countries";
import { hmacSha256Hex, verifyHmacSha256 } from "../crypto";

export interface XdigitexConfig {
  apiKey: string;
  baseUrl?: string;
  webhookSecret?: string;
}

export const DEFAULT_PAY_BASE_URL = "https://pay.xdigitex.space/api";
export const ALLOWED_GATEWAYS: readonly PaymentGateway[] = ["card", "mobile"];

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

function parsePayload(text: string): Record<string, unknown> {
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text.slice(0, 400) };
  }
}

function gatewayMessage(payload: Record<string, unknown>, status: number): string {
  const value =
    (typeof payload.message === "string" && payload.message) ||
    (typeof payload.error === "string" && payload.error) ||
    (typeof payload.detail === "string" && payload.detail);
  return value || `Payment gateway rejected the request (${status}).`;
}

/** Normalises any supported international number to `+dialCodeNationalNumber`. */
export function normaliseInternationalPhone(input: string): string | null {
  return detectPaymentNumber(input)?.internationalNumber ?? null;
}

/** Backwards-compatible Kenya-only helper retained for older callers/tests. */
export function normaliseKenyanPhone(input: string): string | null {
  const detected = detectPaymentNumber(input);
  if (!detected || detected.dialCode !== "+254") return null;
  return detected.internationalNumber.slice(1);
}

export interface InitiatePaymentInput {
  gateway: PaymentGateway;
  amount: number;
  currency: string;
  phone: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  description: string;
  callbackUrl?: string;
  webhookUrl?: string;
  referenceHint?: string;
}

export interface InitiatePaymentResult {
  reference: string;
  gateway: PaymentGateway;
  amount: number;
  currency: string;
  redirectUrl: string | null;
  message: string | null;
  raw: Record<string, unknown>;
}

export async function initiatePayment(
  config: XdigitexConfig,
  input: InitiatePaymentInput,
): Promise<InitiatePaymentResult> {
  if (!config.apiKey) {
    throw new PaymentGatewayError(503, "Payment gateway is not configured.", "", "PAYMENT_NOT_CONFIGURED");
  }
  if (!ALLOWED_GATEWAYS.includes(input.gateway)) {
    throw new PaymentGatewayError(400, "Choose mobile money or card payment.", "", "INVALID_GATEWAY");
  }
  const phone = normaliseInternationalPhone(input.phone);
  if (!phone) {
    throw new PaymentGatewayError(
      400,
      "Enter a valid phone number with country code, e.g. +254712345678.",
      "",
      "INVALID_PHONE",
    );
  }
  if (!Number.isInteger(input.amount) || input.amount < 1) {
    throw new PaymentGatewayError(400, "Payment amount must be at least 1 unit.", "", "INVALID_AMOUNT");
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) {
    throw new PaymentGatewayError(400, "Invalid payment currency.", "", "INVALID_CURRENCY");
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl(config)}/payments/initiate`, {
      method: "POST",
      headers: {
        "X-API-Key": config.apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        amount: input.amount,
        currency: input.currency,
        gateway: input.gateway,
        email: input.email || undefined,
        phone,
        first_name: input.firstName || undefined,
        last_name: input.lastName || undefined,
        description: input.description.slice(0, 120),
        callback_url: input.callbackUrl || undefined,
        webhook_url: input.webhookUrl || undefined,
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

  const payload = parsePayload(await response.text());
  if (!response.ok) {
    throw new PaymentGatewayError(
      response.status === 401 || response.status === 403 ? 502 : response.status,
      gatewayMessage(payload, response.status),
      JSON.stringify(payload).slice(0, 500),
      typeof payload.error === "string" ? payload.error : "PAYMENT_REJECTED",
    );
  }
  const reference =
    (typeof payload.reference === "string" && payload.reference) ||
    (typeof payload.transaction_reference === "string" && payload.transaction_reference) ||
    "";
  if (!reference) {
    throw new PaymentGatewayError(
      502,
      "The payment gateway did not return a reference.",
      JSON.stringify(payload).slice(0, 500),
      "PAYMENT_BAD_RESPONSE",
    );
  }
  const redirectUrl =
    typeof payload.redirect_url === "string" && payload.redirect_url.startsWith("https://")
      ? payload.redirect_url
      : null;
  if (input.gateway === "card" && !redirectUrl) {
    throw new PaymentGatewayError(
      502,
      "The card gateway did not return a secure checkout URL.",
      JSON.stringify(payload).slice(0, 500),
      "PAYMENT_BAD_RESPONSE",
    );
  }
  return {
    reference,
    gateway: input.gateway,
    amount: typeof payload.amount === "number" ? payload.amount : input.amount,
    currency: typeof payload.currency === "string" ? payload.currency : input.currency,
    redirectUrl,
    message: typeof payload.message === "string" ? payload.message : null,
    raw: payload,
  };
}

export type GatewayPaymentStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

export interface GatewayStatusResult {
  reference: string;
  status: GatewayPaymentStatus;
  amount: number | null;
  currency: string | null;
  gateway: string | null;
  receipt: string | null;
  raw: Record<string, unknown>;
}

function normaliseStatus(value: unknown): GatewayPaymentStatus {
  const status = String(value ?? "").toLowerCase();
  if (status === "completed" || status === "success" || status === "succeeded") return "completed";
  if (status === "failed" || status === "rejected") return "failed";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (status === "processing" || status === "pending") return status;
  return "pending";
}

export async function fetchPaymentStatus(
  config: XdigitexConfig,
  reference: string,
): Promise<GatewayStatusResult> {
  if (!config.apiKey) {
    throw new PaymentGatewayError(503, "Payment gateway is not configured.", "", "PAYMENT_NOT_CONFIGURED");
  }
  if (!reference || !/^[A-Za-z0-9_-]{4,120}$/.test(reference)) {
    throw new PaymentGatewayError(400, "Invalid payment reference.", "", "INVALID_REFERENCE");
  }
  let response: Response;
  try {
    response = await fetch(`${baseUrl(config)}/payments/${encodeURIComponent(reference)}/status`, {
      headers: { "X-API-Key": config.apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new PaymentGatewayError(
      504,
      "Could not check the payment status.",
      error instanceof Error ? error.message : "Network error",
      "PAYMENT_UNREACHABLE",
    );
  }
  const payload = parsePayload(await response.text());
  if (!response.ok) {
    throw new PaymentGatewayError(
      response.status,
      gatewayMessage(payload, response.status),
      JSON.stringify(payload).slice(0, 500),
      "PAYMENT_STATUS_FAILED",
    );
  }
  const amountRaw = payload.amount;
  const amount = amountRaw === undefined || amountRaw === null ? null : Number(amountRaw);
  const receipt =
    (typeof payload.receipt === "string" && payload.receipt) ||
    (typeof payload.transaction_id === "string" && payload.transaction_id) ||
    (typeof payload.mpesaReceiptNumber === "string" && payload.mpesaReceiptNumber) ||
    null;
  return {
    reference: typeof payload.reference === "string" ? payload.reference : reference,
    status: normaliseStatus(payload.status),
    amount: Number.isFinite(amount) ? amount : null,
    currency: typeof payload.currency === "string" ? payload.currency.toUpperCase() : null,
    gateway: typeof payload.gateway === "string" ? payload.gateway.toLowerCase() : null,
    receipt,
    raw: payload,
  };
}

/**
 * Verifies a webhook claim against the gateway itself. A forged POST cannot
 * complete a payment because the server re-reads the authoritative status.
 */
export async function verifyGatewaySettlement(
  config: XdigitexConfig,
  reference: string,
  expectedAmount: number,
  expectedCurrency: string,
): Promise<GatewayStatusResult> {
  const status = await fetchPaymentStatus(config, reference);
  if (status.status === "completed") {
    const amountMismatch = status.amount !== null && Math.abs(status.amount - expectedAmount) >= 1;
    const currencyMismatch = status.currency !== null && status.currency !== expectedCurrency;
    if (amountMismatch || currencyMismatch) {
      throw new PaymentGatewayError(
        409,
        "Gateway settlement does not match the payment record.",
        JSON.stringify({ expectedAmount, expectedCurrency, gateway: status }),
        "PAYMENT_MISMATCH",
      );
    }
  }
  return status;
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
}): XdigitexConfig | null {
  if (!env.XDIGITEX_PAY_API_KEY) return null;
  return {
    apiKey: env.XDIGITEX_PAY_API_KEY,
    baseUrl: env.XDIGITEX_PAY_BASE_URL || DEFAULT_PAY_BASE_URL,
    webhookSecret: env.XDIGITEX_WEBHOOK_SECRET,
  };
}
