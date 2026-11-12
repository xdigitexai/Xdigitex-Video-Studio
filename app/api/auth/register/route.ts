import { registerAccount } from "@/lib/server/accounts";
import { createSession } from "@/lib/server/auth";
import { contextFromRequest, guardMutation, auditRequest } from "@/lib/server/context";
import { sendEmail } from "@/lib/server/email";
import { ApiError, errorResponse, json, readJson, clientIp, userAgent } from "@/lib/server/http";
import { appBaseUrl } from "@/lib/server/runtime";
import { publicUser, sessionCookieHeader } from "@/lib/server/session";
import { isEmailVerificationRequired, isSignupEnabled } from "@/lib/server/settings";
import { normalizeEmail, safeString } from "@/lib/server/util";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { db, env } = await contextFromRequest(request);
    await guardMutation(request, db, "register", 6, 10 * 60_000);
    if (!(await isSignupEnabled(db))) {
      throw new ApiError(403, "New registrations are currently closed.", "SIGNUP_DISABLED");
    }
    const body = await readJson<{ email?: string; password?: string; displayName?: string }>(request);
    const email = normalizeEmail(String(body.email ?? ""));
    const verificationRequired = await isEmailVerificationRequired(db);
    const emailConfigured = Boolean(
      (env.RESEND_API_KEY && env.EMAIL_FROM) ||
        env.EMAIL_RELAY_URL ||
        (env.MAIL_API_URL && env.MAIL_API_KEY),
    );
    const devMode = env.EMAIL_DEV_MODE === "true";
    if (verificationRequired && !emailConfigured && !devMode) {
      throw new ApiError(
        503,
        "Email delivery is not configured, so accounts cannot be verified. Contact the administrator.",
        "EMAIL_NOT_CONFIGURED",
      );
    }

    const { user, verificationToken } = await registerAccount(db, {
      email,
      password: String(body.password ?? ""),
      displayName: safeString(body.displayName, 80),
      adminEmails: (env.ADMIN_EMAILS || "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
      emailVerificationRequired: verificationRequired,
    });

    let devVerificationUrl: string | undefined;
    if (verificationToken) {
      const url = `${appBaseUrl(env, request)}/verify-email?token=${encodeURIComponent(verificationToken)}`;
      const sent = await sendEmail(
        db,
        {
          to: email,
          kind: "verify_email",
          subject: "Verify your Xdigitex Studio email",
          text: `Welcome to Xdigitex Video Studio.\n\nVerify your email address: ${url}\n\nThis link expires in 24 hours.`,
        },
        {
          resendApiKey: env.RESEND_API_KEY,
          from: env.EMAIL_FROM,
          mailApiUrl: env.MAIL_API_URL,
          mailApiKey: env.MAIL_API_KEY,
          relayUrl: env.EMAIL_RELAY_URL,
          relaySecret: env.EMAIL_RELAY_SECRET,
        },
      );
      if (devMode && !sent.delivered) devVerificationUrl = url;
    }

    await auditRequest(db, request, { user, via: "session" }, "auth.register", "user", user.id, {
      email: user.email,
      verificationRequired,
      ip: clientIp(request),
      agent: userAgent(request),
    });

    if (!verificationToken) {
      const session = await createSession(db, user.id, {
        ip: clientIp(request),
        userAgent: userAgent(request),
      });
      return json(
        { ok: true, requiresVerification: false, user: publicUser(user) },
        201,
        { "set-cookie": sessionCookieHeader(request, session.token, session.expiresAt) },
      );
    }
    return json(
      {
        ok: true,
        requiresVerification: true,
        email: user.email,
        ...(devVerificationUrl ? { devVerificationUrl } : {}),
      },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
