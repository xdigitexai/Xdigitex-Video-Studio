import { auditRequest, guardMutation, requireAdmin, requireSuperAdmin } from "@/lib/server/context";
import { findUserById } from "@/lib/server/auth";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { now, safeString } from "@/lib/server/util";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

const ROLES = ["super_admin", "admin", "customer"];

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const body = await readJson<{ role?: string; status?: string; displayName?: string }>(request);
    const roleChange = typeof body.role === "string";
    const { db, actor } = roleChange ? await requireSuperAdmin(request) : await requireAdmin(request);
    await guardMutation(request, db, "admin-user-update", 40, 60_000);
    const user = await findUserById(db, id);
    if (!user) throw new ApiError(404, "User not found.", "USER_NOT_FOUND");
    const updates: Record<string, unknown> = { updated_at: now() };
    if (typeof body.displayName === "string") {
      const name = safeString(body.displayName, 80);
      if (!name) throw new ApiError(400, "Display name cannot be empty.", "INVALID_NAME");
      updates.display_name = name;
    }
    if (typeof body.status === "string") {
      if (!["active", "suspended"].includes(body.status)) {
        throw new ApiError(400, "Invalid account status.", "INVALID_STATUS");
      }
      if (user.id === actor.user.id) throw new ApiError(400, "You cannot suspend your own account.", "SELF_UPDATE");
      updates.status = body.status;
    }
    if (roleChange) {
      if (!ROLES.includes(body.role!)) throw new ApiError(400, "Invalid role.", "INVALID_ROLE");
      if (user.id === actor.user.id) throw new ApiError(400, "You cannot change your own role.", "SELF_UPDATE");
      if (user.role === "super_admin" && body.role !== "super_admin") {
        const supers = await db.first<{ count: number }>(
          `SELECT COUNT(*) AS count FROM users WHERE role = 'super_admin' AND status = 'active'`,
        );
        if ((supers?.count ?? 0) <= 1) {
          throw new ApiError(409, "At least one active super administrator is required.", "LAST_SUPER_ADMIN");
        }
      }
      updates.role = body.role;
    }
    const columns = Object.keys(updates);
    await db.run(
      `UPDATE users SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`,
      [...Object.values(updates), id] as Array<string | number | null>,
    );
    if (updates.status === "suspended") {
      await db.run(`DELETE FROM sessions WHERE user_id = ?`, [id]);
    }
    await auditRequest(db, request, actor, "admin.user_updated", "user", id, { fields: Object.keys(updates) });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
