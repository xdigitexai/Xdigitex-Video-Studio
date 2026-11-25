import { isAdminRole } from "@/lib/server/auth";
import { guardMutation, requireUser } from "@/lib/server/context";
import { ApiError, errorResponse, json } from "@/lib/server/http";
import { decryptMfaSecret, encryptMfaSecret, generateMfaSecret, mfaProvisioningUri, verifyTotp } from "@/lib/server/mfa";

export const dynamic = "force-dynamic";

/** Reports MFA state without allowing a customer to probe admin settings. */
export async function GET(request: Request) {
  try {
    const { actor } = await requireUser(request);
    if (!isAdminRole(actor.user.role)) {
      throw new ApiError(403, "Administrator access is required.", "FORBIDDEN");
    }
    return json({
      enabled: actor.user.mfa_enabled === 1,
      verified: actor.mfaVerified === true,
      enrolled: Boolean(actor.user.mfa_secret),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Starts TOTP enrolment. The secret is returned once and stored encrypted. */
export async function POST(request: Request) {
  try {
    const { db, env, actor } = await requireUser(request);
    if (!isAdminRole(actor.user.role)) {
      throw new ApiError(403, "Administrator access is required.", "FORBIDDEN");
    }
    await guardMutation(request, db, "admin-mfa-setup", 5, 10 * 60_000);
    if (!env.SECRETS_ENCRYPTION_KEY) {
      throw new ApiError(503, "MFA is not configured on the server.", "MFA_NOT_CONFIGURED");
    }
    if (actor.user.mfa_enabled === 1) {
      throw new ApiError(409, "MFA is already enabled.", "MFA_ALREADY_ENABLED");
    }
    const secret = generateMfaSecret();
    await db.run(`UPDATE users SET mfa_secret = ?, updated_at = ? WHERE id = ?`, [
      await encryptMfaSecret(secret, env.SECRETS_ENCRYPTION_KEY),
      Date.now(),
      actor.user.id,
    ]);
    return json({
      secret,
      provisioningUri: mfaProvisioningUri(secret, actor.user.email),
      message: "Scan the QR URI with an authenticator app, then enter the 6-digit code to enable MFA.",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
