import type { Role, UserRow } from "@/lib/server/auth-types";
import { createSession } from "@/lib/server/auth";
import { auditRequest, contextFromRequest, guardMutation } from "@/lib/server/context";
import { ApiError, clientIp, errorResponse, json, readJson, userAgent } from "@/lib/server/http";
import { adminEmails } from "@/lib/server/runtime";
import { publicUser, sessionCookieHeader } from "@/lib/server/session";
import { normalizeEmail } from "@/lib/server/util";

export const dynamic = "force-dynamic";

interface GoogleClaims {
  aud?: string;
  exp?: number | string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  error?: string;
}

async function verifyCredential(credential: string, clientId: string): Promise<GoogleClaims> {
  if (!credential || credential.length > 8192) {
    throw new ApiError(400, "Google sign-in credential is missing.", "INVALID_GOOGLE_CREDENTIAL");
  }
  const endpoint = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`;
  let response: Response;
  try {
    response = await fetch(endpoint, { headers: { accept: "application/json" } });
  } catch {
    throw new ApiError(503, "Google sign-in is temporarily unavailable.", "GOOGLE_UNAVAILABLE");
  }
  if (!response.ok) {
    throw new ApiError(401, "Google sign-in token is invalid or expired.", "INVALID_GOOGLE_CREDENTIAL");
  }
  const claims = (await response.json()) as GoogleClaims;
  if (claims.error) {
    throw new ApiError(401, "Google sign-in token is invalid or expired.", "INVALID_GOOGLE_CREDENTIAL");
  }
  if (claims.aud !== clientId) {
    throw new ApiError(401, "This Google sign-in was issued for another application.", "GOOGLE_AUDIENCE_MISMATCH");
  }
  const expiresAt = Number(claims.exp || 0);
  if (!expiresAt || expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new ApiError(401, "Google sign-in token has expired.", "GOOGLE_TOKEN_EXPIRED");
  }
  const verified = claims.email_verified === true || claims.email_verified === "true";
  if (!verified || !claims.email) {
    throw new ApiError(403, "Verify your Google email address and try again.", "GOOGLE_EMAIL_NOT_VERIFIED");
  }
  return claims;
}

export async function POST(request: Request) {
  try {
    const { db, env } = await contextFromRequest(request);
    await guardMutation(request, db, "google-login", 10, 10 * 60_000);
    const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
    if (!clientId) {
      throw new ApiError(503, "Google sign-in is not configured.", "GOOGLE_NOT_CONFIGURED");
    }
    const body = await readJson<{ credential?: string }>(request);
    const claims = await verifyCredential(String(body.credential ?? ""), clientId);
    const emailNormalized = normalizeEmail(claims.email!);
    const timestamp = Date.now();
    let user = await db.first<UserRow>(`SELECT * FROM users WHERE email_normalized = ? LIMIT 1`, [emailNormalized]);

    if (!user) {
      const id = `usr_${crypto.randomUUID().replace(/-/g, "")}`;
      const role: Role = adminEmails(env).includes(emailNormalized) ? "super_admin" : "customer";
      const displayName = String(claims.name || emailNormalized.split("@")[0]).slice(0, 80) || "Creator";
      await db.batch([
        {
          sql: `INSERT INTO users (id, email, email_normalized, password_hash, display_name, role, status, email_verified_at, legacy_owner_id, last_login_at, created_at, updated_at)
                VALUES (?, ?, ?, NULL, ?, ?, 'active', ?, NULL, NULL, ?, ?)`,
          params: [id, claims.email!.slice(0, 254), emailNormalized, displayName, role, timestamp, timestamp, timestamp],
        },
        {
          sql: `INSERT OR IGNORE INTO credit_wallets (user_id, balance, reserved, lifetime_purchased, lifetime_granted, lifetime_consumed, updated_at)
                VALUES (?, 0, 0, 0, 0, 0, ?)`,
          params: [id, timestamp],
        },
      ]);
      user = await db.first<UserRow>(`SELECT * FROM users WHERE id = ?`, [id]);
    } else {
      if (user.status !== "active") {
        throw new ApiError(403, "This account is suspended. Contact support.", "ACCOUNT_SUSPENDED");
      }
      if (!user.email_verified_at) {
        await db.run(`UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?`, [
          timestamp,
          timestamp,
          user.id,
        ]);
        user = { ...user, email_verified_at: timestamp };
      }
    }
    if (!user) throw new ApiError(500, "Could not load your account.", "ACCOUNT_NOT_FOUND");

    const session = await createSession(db, user.id, {
      ip: clientIp(request),
      userAgent: userAgent(request),
    });
    await auditRequest(db, request, { user, via: "session" }, "auth.google_login", "user", user.id, {
      email: user.email,
    });
    return json(
      { ok: true, user: publicUser(user) },
      200,
      { "set-cookie": sessionCookieHeader(request, session.token, session.expiresAt) },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
