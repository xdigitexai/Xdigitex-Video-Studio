import { createPasswordReset } from "@/lib/server/accounts";
import { contextFromRequest, guardMutation } from "@/lib/server/context";
import { sendEmail } from "@/lib/server/email";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { appBaseUrl } from "@/lib/server/runtime";
import { normalizeEmail } from "@/lib/server/util";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { db, env } = await contextFromRequest(request);
    await guardMutation(request, db, "forgot-password", 5, 10 * 60_000);
    const body = await readJson<{ email?: string }>(request);
    const email = body.email ? normalizeEmail(String(body.email)) : "";
    let devResetUrl: string | undefined;
    if (email) {
      const reset = await createPasswordReset(db, email);
      if (reset) {
        const url = `${appBaseUrl(env, request)}/reset-password?token=${encodeURIComponent(reset.token)}`;
        const sent = await sendEmail(
          db,
          {
            to: reset.user.email,
            kind: "reset_password",
            subject: "Reset your Xdigitex Studio password",
            text: `Reset your password: ${url}\n\nThis link expires in 60 minutes. If you did not request this, ignore this email.`,
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
        if (env.EMAIL_DEV_MODE === "true" && !sent.delivered) devResetUrl = url;
      }
    }
    return json({
      ok: true,
      message: "If an account exists for that email, a reset link has been sent.",
      ...(devResetUrl ? { devResetUrl } : {}),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
