import { auditRequest, guardMutation, requireUser } from "@/lib/server/context";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { publicUser } from "@/lib/server/session";
import { now, safeString } from "@/lib/server/util";
import { findUserById } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const { db, actor } = await requireUser(request);
    await guardMutation(request, db, "profile", 20, 60_000);
    const body = await readJson<{ displayName?: string }>(request);
    const displayName = safeString(body.displayName, 80);
    if (!displayName) {
      return json({ error: "Display name cannot be empty.", code: "INVALID_NAME" }, 400);
    }
    await db.run(`UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?`, [
      displayName,
      now(),
      actor.user.id,
    ]);
    await auditRequest(db, request, actor, "user.profile_updated", "user", actor.user.id, { displayName });
    const user = await findUserById(db, actor.user.id);
    return json({ ok: true, user: publicUser(user!) });
  } catch (error) {
    return errorResponse(error);
  }
}
