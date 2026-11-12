import type { Db } from "./db";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, message: string, code = "REQUEST_FAILED", details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const NO_STORE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  "x-content-type-options": "nosniff",
} as const;

export function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...NO_STORE_HEADERS, ...extraHeaders },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return json({ error: error.message, code: error.code, details: error.details }, error.status);
  }
  console.error("[api] unhandled error", error);
  return json({ error: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" }, 500);
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new ApiError(415, "Expected a JSON request body.", "UNSUPPORTED_MEDIA_TYPE");
  }
  const text = await request.text();
  if (text.length > 1_000_000) throw new ApiError(413, "Request body is too large.", "PAYLOAD_TOO_LARGE");
  try {
    return JSON.parse(text || "{}") as T;
  } catch {
    throw new ApiError(400, "Request body is not valid JSON.", "INVALID_JSON");
  }
}

/** CSRF defence: reject cross-site state-changing requests. */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") throw new ApiError(403, "Cross-site request blocked.", "CSRF_BLOCKED");
  if (!origin) return; // Same-origin fetch may omit Origin on some runtimes.
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError(403, "Invalid request origin.", "CSRF_BLOCKED");
  }
  const host = request.headers.get("host") || new URL(request.url).host;
  if (originHost !== host) throw new ApiError(403, "Cross-site request blocked.", "CSRF_BLOCKED");
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local"
  );
}

export function userAgent(request: Request): string {
  return (request.headers.get("user-agent") || "").slice(0, 300);
}

export function baseUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Atomic fixed-window rate limit backed by D1. */
export async function consumeRateLimit(
  db: Db,
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const timestamp = Date.now();
  const windowStart = Math.floor(timestamp / windowMs) * windowMs;
  const row = await db.first<{ count: number }>(
    `INSERT INTO api_rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1
     RETURNING count`,
    [key, windowStart],
  );
  const count = row?.count ?? 1;
  if (Math.random() < 0.01) {
    db.run(`DELETE FROM api_rate_limits WHERE window_start < ?`, [windowStart - windowMs * 2]).catch(() => undefined);
  }
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - timestamp) / 1000)),
  };
}

export async function enforceRateLimit(
  db: Db,
  key: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const result = await consumeRateLimit(db, key, limit, windowMs);
  if (!result.allowed) {
    throw new ApiError(429, "Too many requests. Please wait and try again.", "RATE_LIMITED", {
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }
}

export function parseCookies(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

export function serialiseCookie(
  name: string,
  value: string,
  options: { maxAgeSeconds?: number; secure?: boolean; path?: string } = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? "/"}`, "HttpOnly", "SameSite=Lax"];
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`);
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}
