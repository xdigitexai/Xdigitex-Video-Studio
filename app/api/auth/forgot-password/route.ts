import { createPasswordReset } from "@/lib/server/accounts";
import { contextFromRequest, guardMutation } from "@/lib/server/context";
import { emailConfig, trySendRenderedEmail } from "@/lib/server/email-notifications";
import { resetPasswordEmail } from "@/lib/server/email-templates";
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
        const siteUrl = appBaseUrl(env, request);
        const url = `${siteUrl}/reset-password?token=${encodeURIComponent(reset.token)}`;
        const sent = await trySendRenderedEmail(
          db,
          emailConfig(env, request),
          reset.user.email,
          "reset_password",
          resetPasswordEmail({ name: reset.user.display_name, url, siteUrl }),
        );
        if (env.EMAIL_DEV_MODE === "true" && !sent?.delivered) devResetUrl = url;
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
