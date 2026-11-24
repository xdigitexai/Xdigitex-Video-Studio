import { changePassword } from "@/lib/server/accounts";
import { destroyAllSessions, SESSION_COOKIE } from "@/lib/server/auth";
import { auditRequest, guardMutation, requireUser } from "@/lib/server/context";
import { emailConfig, trySendRenderedEmail } from "@/lib/server/email-notifications";
import { passwordChangedEmail } from "@/lib/server/email-templates";
import { errorResponse, json, parseCookies, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { db, env, actor } = await requireUser(request);
    await guardMutation(request, db, "change-password", 8, 10 * 60_000);
    const body = await readJson<{ currentPassword?: string; newPassword?: string }>(request);
    await changePassword(
      db,
      actor.user,
      String(body.currentPassword ?? ""),
      String(body.newPassword ?? ""),
    );
    const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
    await destroyAllSessions(db, actor.user.id, token);
    await auditRequest(db, request, actor, "auth.password_changed", "user", actor.user.id);
    await trySendRenderedEmail(
      db,
      emailConfig(env, request),
      actor.user.email,
      "password_changed",
      passwordChangedEmail({ name: actor.user.display_name, siteUrl: env.APP_URL }),
    );
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
