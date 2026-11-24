import { issueVerificationEmail } from "@/lib/server/accounts";
import { auditRequest, contextFromRequest, guardMutation } from "@/lib/server/context";
import { emailConfig, trySendRenderedEmail } from "@/lib/server/email-notifications";
import { verificationEmail } from "@/lib/server/email-templates";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { appBaseUrl } from "@/lib/server/runtime";
import { normalizeEmail } from "@/lib/server/util";
import { findUserByEmail } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { db, env } = await contextFromRequest(request);
    await guardMutation(request, db, "resend-verification", 5, 10 * 60_000);
    const body = await readJson<{ email?: string }>(request);
    const email = body.email ? normalizeEmail(String(body.email)) : "";
    const user = email ? await findUserByEmail(db, email) : null;
    let devVerificationUrl: string | undefined;
    if (user && !user.email_verified_at) {
      const token = await issueVerificationEmail(db, user);
      const siteUrl = appBaseUrl(env, request);
      const url = `${siteUrl}/verify-email?token=${encodeURIComponent(token)}`;
      const sent = await trySendRenderedEmail(
        db,
        emailConfig(env, request),
        user.email,
        "verify_email",
        verificationEmail({ name: user.display_name, url, siteUrl }),
      );
      if (env.EMAIL_DEV_MODE === "true" && !sent?.delivered) devVerificationUrl = url;
      await auditRequest(db, request, null, "auth.verification_resent", "user", user.id);
    }
    return json({ ok: true, ...(devVerificationUrl ? { devVerificationUrl } : {}) });
  } catch (error) {
    return errorResponse(error);
  }
}
