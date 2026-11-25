import { requireAdmin } from "@/lib/server/context";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { decryptMfaSecret, verifyTotp } from "@/lib/server/mfa";

export const dynamic = "force-dynamic";

/** Disables MFA only after a current authenticator code is supplied. */
export async function POST(request: Request) {
  try {
    const { db, env, actor } = await requireAdmin(request);
    if (actor.user.mfa_enabled !== 1 || !actor.user.mfa_secret) {
      return json({ ok: true, alreadyDisabled: true });
    }
    if (!env.SECRETS_ENCRYPTION_KEY) {
      throw new ApiError(503, "MFA is not configured on the server.", "MFA_NOT_CONFIGURED");
    }
    const body = await readJson<{ code?: string }>(request);
    const secret = await decryptMfaSecret(actor.user.mfa_secret, env.SECRETS_ENCRYPTION_KEY);
    if (!secret || !(await verifyTotp(secret, String(body.code ?? "")))) {
      throw new ApiError(400, "That authenticator code is invalid or expired.", "INVALID_MFA_CODE");
    }
    await db.run(`UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, updated_at = ? WHERE id = ?`, [
      Date.now(),
      actor.user.id,
    ]);
    await db.run(`UPDATE sessions SET mfa_verified_at = NULL WHERE user_id = ?`, [actor.user.id]);
    return json({ ok: true, enabled: false });
  } catch (error) {
    return errorResponse(error);
  }
}
