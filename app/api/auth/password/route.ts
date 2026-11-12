import { changePassword } from "@/lib/server/accounts";
import { destroyAllSessions, SESSION_COOKIE } from "@/lib/server/auth";
import { auditRequest, guardMutation, requireUser } from "@/lib/server/context";
import { errorResponse, json, parseCookies, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { db, actor } = await requireUser(request);
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
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
