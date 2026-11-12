import type { Db } from "./db";
import type { Actor, AuthConfig, Role, UserRow } from "./auth-types";
import { sha256Hex } from "./crypto";
import { parseCookies } from "./http";

export type { Actor, AuthConfig, Role, UserRow } from "./auth-types";

export const SESSION_COOKIE = "xdg_session";
const PLATFORM_ID_HEADER = "oai-authenticated-user-id";
const PLATFORM_EMAIL_HEADER = "oai-authenticated-user-email";
const PLATFORM_NAME_HEADER = "oai-authenticated-user-full-name";
const PLATFORM_NAME_ENCODING_HEADER = "oai-authenticated-user-full-name-encoding";
const SESSION_DAYS = 30;

export function isAdminRole(role: string): boolean {
  return role === "super_admin" || role === "admin";
}

export function isSuperAdminRole(role: string): boolean {
  return role === "super_admin";
}

export async function findUserById(db: Db, id: string): Promise<UserRow | null> {
  return db.first<UserRow>(`SELECT * FROM users WHERE id = ?`, [id]);
}

export async function findUserByEmail(db: Db, emailNormalized: string): Promise<UserRow | null> {
  return db.first<UserRow>(`SELECT * FROM users WHERE email_normalized = ?`, [emailNormalized]);
}

export async function findUserByLegacyId(db: Db, legacyOwnerId: string): Promise<UserRow | null> {
  return db.first<UserRow>(`SELECT * FROM users WHERE legacy_owner_id = ?`, [legacyOwnerId]);
}

export async function createSession(
  db: Db,
  userId: string,
  meta: { ip?: string; userAgent?: string; days?: number },
): Promise<{ token: string; expiresAt: number }> {
  const token = crypto.getRandomValues(new Uint8Array(32));
  const tokenString = Array.from(token)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const id = await sha256Hex(tokenString);
  const timestamp = Date.now();
  const expiresAt = timestamp + (meta.days ?? SESSION_DAYS) * 86_400_000;
  await db.run(
    `INSERT INTO sessions (id, user_id, expires_at, created_at, last_seen_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, expiresAt, timestamp, timestamp, meta.ip ?? null, meta.userAgent?.slice(0, 300) ?? null],
  );
  await db.run(`UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?`, [timestamp, timestamp, userId]);
  return { token: tokenString, expiresAt };
}

export async function destroySession(db: Db, token: string): Promise<void> {
  const id = await sha256Hex(token);
  await db.run(`DELETE FROM sessions WHERE id = ?`, [id]);
}

export async function destroyAllSessions(db: Db, userId: string, exceptToken?: string): Promise<void> {
  if (exceptToken) {
    const id = await sha256Hex(exceptToken);
    await db.run(`DELETE FROM sessions WHERE user_id = ? AND id != ?`, [userId, id]);
    return;
  }
  await db.run(`DELETE FROM sessions WHERE user_id = ?`, [userId]);
}

export async function listSessions(db: Db, userId: string): Promise<Array<{ id: string; created_at: number; last_seen_at: number; ip: string | null; user_agent: string | null; expires_at: number }>> {
  return db.all(
    `SELECT id, created_at, last_seen_at, ip, user_agent, expires_at FROM sessions
     WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC LIMIT 20`,
    [userId, Date.now()],
  );
}

async function actorFromSessionToken(db: Db, token: string): Promise<{ actor: Actor; sessionId: string } | null> {
  const id = await sha256Hex(token);
  const row = await db.first<UserRow & { session_id: string; session_expires: number; last_seen_at: number }>(
    `SELECT u.*, s.id AS session_id, s.expires_at AS session_expires, s.last_seen_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? LIMIT 1`,
    [id],
  );
  if (!row) return null;
  if (row.session_expires <= Date.now()) {
    await db.run(`DELETE FROM sessions WHERE id = ?`, [id]);
    return null;
  }
  if (row.status !== "active") return null;
  // Touch at most once per hour to keep reads cheap.
  if (Date.now() - row.last_seen_at > 3_600_000) {
    await db.run(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`, [Date.now(), id]);
  }
  return { actor: { user: row, via: "session" }, sessionId: id };
}

/**
 * Resolves the request actor.
 *
 * 1. A real Xdigitex session cookie always wins.
 * 2. When platform header auth is enabled, the trusted Sites dispatch identity is
 *    mapped to a local user (claimed once). This keeps the existing private
 *    deployment working while customer accounts are introduced.
 */
export async function resolveActor(
  db: Db,
  requestHeaders: Headers,
  config: AuthConfig,
): Promise<Actor | null> {
  const cookies = parseCookies(requestHeaders.get("cookie"));
  const token = cookies[SESSION_COOKIE];
  if (token) {
    const session = await actorFromSessionToken(db, token);
    if (session) return session.actor;
  }

  if (!config.platformAuthEnabled) return null;
  const legacyId = requestHeaders.get(PLATFORM_ID_HEADER);
  const headerEmail = requestHeaders.get(PLATFORM_EMAIL_HEADER);
  if (!legacyId || !headerEmail) return null;

  const emailNormalized = headerEmail.trim().toLowerCase();
  let user = await findUserByLegacyId(db, legacyId);
  if (!user) {
    const existingByEmail = await findUserByEmail(db, emailNormalized);
    if (existingByEmail && !existingByEmail.legacy_owner_id) {
      await db.run(`UPDATE users SET legacy_owner_id = ?, updated_at = ? WHERE id = ?`, [
        legacyId,
        Date.now(),
        existingByEmail.id,
      ]);
      user = { ...existingByEmail, legacy_owner_id: legacyId };
    }
  }

  if (!user) {
    const encodedName = requestHeaders.get(PLATFORM_NAME_HEADER);
    const fullName =
      encodedName && requestHeaders.get(PLATFORM_NAME_ENCODING_HEADER) === "percent-encoded-utf-8"
        ? safeDecode(encodedName)
        : null;
    const timestamp = Date.now();
    const role: Role = config.adminEmails.includes(emailNormalized) ? "super_admin" : "customer";
    const id = `usr_${crypto.randomUUID().replace(/-/g, "")}`;
    await db.run(
      `INSERT INTO users (id, email, email_normalized, password_hash, display_name, role, status, email_verified_at, legacy_owner_id, last_login_at, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      [id, headerEmail.slice(0, 254), emailNormalized, (fullName || headerEmail).slice(0, 80), role, timestamp, legacyId, timestamp, timestamp, timestamp],
    );
    await db.run(
      `INSERT OR IGNORE INTO credit_wallets (user_id, balance, reserved, lifetime_purchased, lifetime_granted, lifetime_consumed, updated_at)
       VALUES (?, 0, 0, 0, 0, 0, ?)`,
      [id, timestamp],
    );
    user = (await findUserById(db, id))!;
  }

  if (user.status !== "active") return null;
  if (user.id !== legacyId) {
    // Claim any legacy rows that predate local accounts. Idempotent and cheap.
    const hasLegacy = await db.first<{ present: number }>(
      `SELECT 1 AS present FROM projects WHERE owner_id = ? LIMIT 1`,
      [legacyId],
    );
    if (hasLegacy) {
      await db.batch([
        { sql: `UPDATE projects SET owner_id = ? WHERE owner_id = ?`, params: [user.id, legacyId] },
        { sql: `UPDATE assets SET owner_id = ? WHERE owner_id = ?`, params: [user.id, legacyId] },
        { sql: `UPDATE generations SET owner_id = ? WHERE owner_id = ?`, params: [user.id, legacyId] },
      ]);
    }
  }
  return { user, via: "platform_header" };
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
