import { isAdminRole } from "@/lib/server/auth";
import { guardMutation, requireUser } from "@/lib/server/context";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { decryptMfaSecret, verifyTotp } from "@/lib/server/mfa";

export const dynamic = "force-dynamic";

/**
 * Confirms enrolment or verifies an existing admin session. Successful
 * verification stamps the current session so privileged APIs accept it.
 */
export async function POST(request: Request) {
  try {
    const { db, env, actor } = await requireUser(request);
    if (!isAdminRole(actor.user.role)) {
      throw new ApiError(403, "Administrator access is required.", "FORBIDDEN");
    }
    await guardMutation(request, db, "admin-mfa-verify", 8, 10 * 60_000);
    if (!env.SECRETS_ENCRYPTION_KEY) {
      throw new ApiError(503, "MFA is not configured on the server.", "MFA_NOT_CONFIGURED");
    }
    if (actor.user.mfa_enabled === 1 && actor.mfaVerified) {
      return json({ ok: true, alreadyVerified: true });
    }
    if (!actor.user.mfa_secret) {
      throw new ApiError(400, "Start MFA setup before verifying.", "MFA_NOT_SET_UP");
    }
    const body = await readJson<{ code?: string }>(request);
    const secret = await decryptMfaSecret(actor.user.mfa_secret, env.SECRETS_ENCRYPTION_KEY);
    if (!secret || !(await verifyTotp(secret, String(body.code ?? "")))) {
      throw new ApiError(400, "That authenticator code is invalid or expired.", "INVALID_MFA_CODE");
    }
    const timestamp = Date.now();
    if (actor.user.mfa_enabled !== 1) {
      await db.run(`UPDATE users SET mfa_enabled = 1, updated_at = ? WHERE id = ?`, [timestamp, actor.user.id]);
    }
    if (actor.sessionId) {
      await db.run(`UPDATE sessions SET mfa_verified_at = ? WHERE id = ?`, [timestamp, actor.sessionId]);
    }
    return json({ ok: true, enabled: true, verified: true });
  } catch (error) {
    return errorResponse(error);
  }
}
