import type { Db } from "./db";
import type { Actor } from "./auth-types";
import { ApiError } from "./http";
import { isAdminRole, isSuperAdminRole } from "./auth";
import { now } from "./util";

/**
 * Central platform administration.
 *
 * Roles come only from the `users.role` database column. Environment variables
 * never grant a role at login/registration. Fine-grained permissions are read
 * from `admin_permissions`; super admins always have every permission.
 */
export const ADMIN_PERMISSIONS = [
  "admin.access",
  "users.read",
  "users.write",
  "users.roles",
  "plans.read",
  "plans.write",
  "providers.read",
  "providers.write",
  "models.read",
  "models.write",
  "pricing.read",
  "pricing.write",
  "payments.read",
  "payments.write",
  "notifications.read",
  "notifications.write",
  "audit.read",
  "export.read",
  "catalog.read",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

/** Least-privilege permission derived independently from an admin API request. */
export function adminPermissionForRequest(request: Request): AdminPermission {
  const path = new URL(request.url).pathname;
  const write = !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase());
  if (path.startsWith("/api/admin/users")) return write ? "users.write" : "users.read";
  if (path.startsWith("/api/admin/plans")) return write ? "plans.write" : "plans.read";
  if (path.startsWith("/api/admin/providers")) return write ? "providers.write" : "providers.read";
  if (path.startsWith("/api/admin/models")) return write ? "models.write" : "models.read";
  if (path.startsWith("/api/admin/pricing")) return write ? "pricing.write" : "pricing.read";
  if (path.startsWith("/api/admin/payments") || path.startsWith("/api/admin/sweep")) {
    return write ? "payments.write" : "payments.read";
  }
  if (path.startsWith("/api/admin/notifications")) return write ? "notifications.write" : "notifications.read";
  if (path.startsWith("/api/admin/export")) return "export.read";
  if (path.startsWith("/api/admin/audit")) return "audit.read";
  return "admin.access";
}

const ALL: ReadonlySet<AdminPermission> = new Set(ADMIN_PERMISSIONS);

const DEFAULT_ADMIN: ReadonlySet<AdminPermission> = new Set<AdminPermission>([
  "admin.access",
  "users.read",
  "users.write",
  "plans.read",
  "plans.write",
  "providers.read",
  "models.read",
  "models.write",
  "pricing.read",
  "pricing.write",
  "payments.read",
  "notifications.read",
  "notifications.write",
  "audit.read",
  "export.read",
  "catalog.read",
]);

export interface AdminPermissionRow {
  user_id: string;
  permissions: string;
  created_at: number;
  updated_at: number;
}

export function rolePermissions(role: string): ReadonlySet<AdminPermission> {
  if (isSuperAdminRole(role)) return ALL;
  if (role === "admin") return DEFAULT_ADMIN;
  return new Set<AdminPermission>();
}

/** Reads the authoritative permission set for an actor; never trusts headers. */
export async function permissionsForActor(db: Db, actor: Actor): Promise<Set<AdminPermission>> {
  const base = rolePermissions(actor.user.role);
  if (!isAdminRole(actor.user.role)) return new Set<AdminPermission>();
  const row = await db.first<AdminPermissionRow>(
    `SELECT permissions FROM admin_permissions WHERE user_id = ? LIMIT 1`,
    [actor.user.id],
  );
  if (!row) return new Set(base);
  try {
    const stored = JSON.parse(row.permissions) as unknown;
    if (!Array.isArray(stored)) return new Set(base);
    const result = new Set<AdminPermission>(base);
    for (const value of stored) {
      if ((ADMIN_PERMISSIONS as readonly string[]).includes(String(value))) {
        result.add(value as AdminPermission);
      }
    }
    return result;
  } catch {
    return new Set(base);
  }
}

/**
 * Independent authorization gate used by every /admin page and /api/admin route.
 * MFA is enforced when the admin has enrolled, so a stolen password alone is
 * not enough for privileged API calls.
 */
export async function assertAdminPermission(
  db: Db,
  actor: Actor | null,
  permission: AdminPermission = "admin.access",
): Promise<Actor> {
  if (!actor || !isAdminRole(actor.user.role)) {
    throw new ApiError(403, "Administrator access is required.", "FORBIDDEN");
  }
  if (actor.user.status !== "active") {
    throw new ApiError(403, "This account is suspended.", "ACCOUNT_SUSPENDED");
  }
  if (actor.user.mfa_enabled === 1 && actor.mfaVerified !== true) {
    throw new ApiError(403, "Verify your authenticator code before using admin controls.", "MFA_REQUIRED");
  }
  const permissions = await permissionsForActor(db, actor);
  if (!permissions.has(permission)) {
    throw new ApiError(403, `Permission ${permission} is required.`, "FORBIDDEN");
  }
  return actor;
}

export async function grantAdminPermission(
  db: Db,
  userId: string,
  permissions: AdminPermission[],
): Promise<void> {
  const timestamp = now();
  await db.run(
    `INSERT INTO admin_permissions (user_id, permissions, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET permissions = excluded.permissions, updated_at = excluded.updated_at`,
    [userId, JSON.stringify([...new Set(permissions)]), timestamp, timestamp],
  );
}

/** One-time owner bootstrap. Only usable from a server-side script/migration. */
export async function bootstrapOwner(db: Db, email: string): Promise<{ id: string; email: string; created: boolean }> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) {
    throw new ApiError(400, "ADMIN_BOOTSTRAP_EMAIL must be a valid email address.", "INVALID_BOOTSTRAP_EMAIL");
  }
  let user = await db.first<{ id: string; email: string; role: string }>(
    `SELECT id, email, role FROM users WHERE email_normalized = ? LIMIT 1`,
    [normalized],
  );
  if (!user) {
    throw new ApiError(404, "Bootstrap account does not exist. Register normally first, then run bootstrap.", "BOOTSTRAP_USER_NOT_FOUND");
  }
  if (user.role !== "super_admin") {
    await db.run(`UPDATE users SET role = 'super_admin', updated_at = ? WHERE id = ?`, [now(), user.id]);
    user = { ...user, role: "super_admin" };
  }
  await grantAdminPermission(db, user.id, [...ALL]);
  return { id: user.id, email: user.email, created: true };
}
