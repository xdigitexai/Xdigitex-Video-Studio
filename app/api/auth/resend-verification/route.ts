import { issueVerificationEmail } from "@/lib/server/accounts";
import { auditRequest, contextFromRequest, guardMutation } from "@/lib/server/context";
import { sendEmail } from "@/lib/server/email";
import { baseUrl, errorResponse, json, readJson } from "@/lib/server/http";
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
      const url = `${baseUrl(request)}/verify-email?token=${encodeURIComponent(token)}`;
      const sent = await sendEmail(
        db,
        {
          to: user.email,
          kind: "verify_email",
          subject: "Verify your Xdigitex Studio email",
          text: `Verify your email address: ${url}\n\nThis link expires in 24 hours.`,
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
      if (env.EMAIL_DEV_MODE === "true" && !sent.delivered) devVerificationUrl = url;
      await auditRequest(db, request, null, "auth.verification_resent", "user", user.id);
    }
    return json({ ok: true, ...(devVerificationUrl ? { devVerificationUrl } : {}) });
  } catch (error) {
    return errorResponse(error);
  }
}
