import type { UserRow } from "@/lib/server/auth-types";
import { createSession } from "@/lib/server/auth";
import { auditRequest, contextFromRequest } from "@/lib/server/context";
import { emailConfig, trySendRenderedEmail } from "@/lib/server/email-notifications";
import { newLoginEmail } from "@/lib/server/email-templates";
import { clientIp, userAgent } from "@/lib/server/http";
import { publicUser, sessionCookieHeader } from "@/lib/server/session";
import { normalizeEmail } from "@/lib/server/util";

export const dynamic = "force-dynamic";

interface HandoffClaims {
  email?: string;
  name?: string;
  sub?: string;
  email_verified?: boolean;
  exp?: number;
  nonce?: string;
  return_to?: string;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function safeReturn(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  if (value.includes("\\") || value.includes("\r") || value.includes("\n")) return "/dashboard";
  return value;
}

function fail(): Response {
  return new Response(null, {
    status: 302,
    headers: { location: "/login?error=google-handoff-failed", "cache-control": "no-store" },
  });
}

async function verifyToken(token: string, secret: string): Promise<HandoffClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const expected = base64UrlEncode(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(parts[0]))));
  if (!constantTimeEqual(expected, parts[1])) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0]))) as HandoffClaims;
    if (!claims.email || !claims.sub || claims.email_verified !== true) return null;
    if (!claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token") || "";
    const { db, env } = await contextFromRequest(request);
    const secret = env.VIDEOX_GOOGLE_HANDOFF_SECRET;
    if (!secret || !token) return fail();
    const claims = await verifyToken(token, secret);
    if (!claims || !claims.email || !claims.sub) return fail();

    const emailNormalized = normalizeEmail(claims.email);
    const timestamp = Date.now();
    let user = await db.first<UserRow>(`SELECT * FROM users WHERE email_normalized = ? LIMIT 1`, [emailNormalized]);
    if (!user) {
      const id = `usr_${crypto.randomUUID().replace(/-/g, "")}`;
      const role = "customer" as const;
      const displayName = String(claims.name || emailNormalized.split("@")[0]).slice(0, 80) || "Creator";
      await db.batch([
        {
          sql: `INSERT INTO users (id, email, email_normalized, password_hash, display_name, role, status, email_verified_at, legacy_owner_id, last_login_at, created_at, updated_at)
                VALUES (?, ?, ?, NULL, ?, ?, 'active', ?, NULL, NULL, ?, ?)`,
          params: [id, claims.email.slice(0, 254), emailNormalized, displayName, role, timestamp, timestamp, timestamp],
        },
        {
          sql: `INSERT OR IGNORE INTO credit_wallets (user_id, balance, reserved, lifetime_purchased, lifetime_granted, lifetime_consumed, updated_at)
                VALUES (?, 0, 0, 0, 0, 0, ?)`,
          params: [id, timestamp],
        },
      ]);
      user = await db.first<UserRow>(`SELECT * FROM users WHERE id = ?`, [id]);
    } else {
      if (user.status !== "active") return fail();
      if (!user.email_verified_at) {
        await db.run(`UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?`, [
          timestamp, timestamp, user.id,
        ]);
        user = { ...user, email_verified_at: timestamp };
      }
    }
    if (!user) return fail();

    const session = await createSession(db, user.id, {
      ip: clientIp(request),
      userAgent: userAgent(request),
    });
    await auditRequest(db, request, { user, via: "session" }, "auth.google_login", "user", user.id, {
      email: user.email,
      via: "mail-handoff",
      google_sub: claims.sub,
    });
    await trySendRenderedEmail(
      db,
      emailConfig(env, request),
      user.email,
      "new_login",
      newLoginEmail({
        name: user.display_name,
        ip: clientIp(request),
        device: userAgent(request),
        time: timestamp,
        siteUrl: env.APP_URL,
      }),
    );
    const requested = safeReturn(claims.return_to);
    const destination = requested;
    return new Response(null, {
      status: 302,
      headers: {
        location: destination,
        "set-cookie": sessionCookieHeader(request, session.token, session.expiresAt),
        "cache-control": "no-store",
      },
    });
  } catch {
    return fail();
  }
}
