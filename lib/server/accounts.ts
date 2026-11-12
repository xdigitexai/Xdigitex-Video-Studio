import type { Db } from "./db";
import type { Role, UserRow } from "./auth-types";
import { hashPassword, randomToken, sha256Hex, verifyPassword } from "./crypto";
import { ApiError } from "./http";
import { newId, normalizeEmail, now, isValidEmail } from "./util";

export const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;
const VERIFY_TTL = 24 * 60 * 60 * 1000;
const RESET_TTL = 60 * 60 * 1000;

export function assertPasswordPolicy(password: string): void {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new ApiError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, "WEAK_PASSWORD");
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new ApiError(400, "Password is too long.", "WEAK_PASSWORD");
  }
}

export function assertEmail(email: string): string {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) throw new ApiError(400, "Enter a valid email address.", "INVALID_EMAIL");
  return normalized;
}

async function createAuthToken(
  db: Db,
  userId: string,
  kind: "verify_email" | "reset_password",
  ttlMs: number,
): Promise<string> {
  await db.run(`DELETE FROM auth_tokens WHERE user_id = ? AND kind = ?`, [userId, kind]);
  const token = randomToken(32);
  const hash = await sha256Hex(token);
  const timestamp = now();
  await db.run(
    `INSERT INTO auth_tokens (id, user_id, kind, token_hash, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    [newId("tok"), userId, kind, hash, timestamp + ttlMs, timestamp],
  );
  return token;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName?: string;
  adminEmails?: string[];
  emailVerificationRequired?: boolean;
  signupCredits?: number;
}

export interface RegisterResult {
  user: UserRow;
  verificationToken: string | null;
}

export async function registerAccount(db: Db, input: RegisterInput): Promise<RegisterResult> {
  const emailNormalized = assertEmail(input.email);
  assertPasswordPolicy(input.password);
  const existing = await db.first<{ id: string }>(`SELECT id FROM users WHERE email_normalized = ? LIMIT 1`, [
    emailNormalized,
  ]);
  if (existing) {
    throw new ApiError(409, "An account with this email already exists. Try signing in.", "EMAIL_IN_USE");
  }
  const timestamp = now();
  const id = newId("usr");
  const role: Role = (input.adminEmails ?? []).includes(emailNormalized) ? "super_admin" : "customer";
  const displayName = (input.displayName || emailNormalized.split("@")[0]).trim().slice(0, 80) || "Creator";
  const passwordHash = await hashPassword(input.password);
  const verified = input.emailVerificationRequired === false;
  await db.run(
    `INSERT INTO users (id, email, email_normalized, password_hash, display_name, role, status, email_verified_at, legacy_owner_id, last_login_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, NULL, NULL, ?, ?)`,
    [
      id,
      normalizeEmail(input.email).slice(0, 254),
      emailNormalized,
      passwordHash,
      displayName,
      role,
      verified ? timestamp : null,
      timestamp,
      timestamp,
    ],
  );
  await db.run(
    `INSERT OR IGNORE INTO credit_wallets (user_id, balance, reserved, lifetime_purchased, lifetime_granted, lifetime_consumed, updated_at)
     VALUES (?, 0, 0, 0, 0, 0, ?)`,
    [id, timestamp],
  );
  if ((input.signupCredits ?? 0) > 0) {
    const { grantCredits } = await import("./credits");
    await grantCredits(db, {
      userId: id,
      credits: input.signupCredits ?? 0,
      source: "promo",
      sourceId: "signup",
      reference: `signup:${id}`,
      description: "Welcome credits",
    });
  }
  const verificationToken = verified ? null : await createAuthToken(db, id, "verify_email", VERIFY_TTL);
  const user = await db.first<UserRow>(`SELECT * FROM users WHERE id = ?`, [id]);
  return { user: user!, verificationToken };
}

export interface LoginResult {
  user: UserRow;
}

// A fixed hash used to equalise timing for unknown accounts.
const DUMMY_HASH =
  "pbkdf2$210000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export async function authenticateAccount(
  db: Db,
  email: string,
  password: string,
  options: { emailVerificationRequired?: boolean } = {},
): Promise<LoginResult> {
  const emailNormalized = normalizeEmail(email);
  if (!emailNormalized || typeof password !== "string") {
    throw new ApiError(400, "Enter your email and password.", "INVALID_CREDENTIALS");
  }
  const user = await db.first<UserRow>(`SELECT * FROM users WHERE email_normalized = ? LIMIT 1`, [emailNormalized]);
  const valid = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !user.password_hash || !valid) {
    throw new ApiError(401, "Email or password is incorrect.", "INVALID_CREDENTIALS");
  }
  if (user.status !== "active") {
    throw new ApiError(403, "This account is suspended. Contact support.", "ACCOUNT_SUSPENDED");
  }
  if (options.emailVerificationRequired !== false && !user.email_verified_at) {
    throw new ApiError(403, "Verify your email address before signing in.", "EMAIL_NOT_VERIFIED");
  }
  return { user };
}

export async function issueVerificationEmail(
  db: Db,
  user: UserRow,
): Promise<string> {
  return createAuthToken(db, user.id, "verify_email", VERIFY_TTL);
}

export async function verifyEmailToken(db: Db, token: string): Promise<UserRow | null> {
  if (!token || token.length < 20) return null;
  const hash = await sha256Hex(token);
  const row = await db.first<{ id: string; user_id: string; expires_at: number; used_at: number | null }>(
    `SELECT id, user_id, expires_at, used_at FROM auth_tokens WHERE token_hash = ? AND kind = 'verify_email' LIMIT 1`,
    [hash],
  );
  if (!row || row.used_at || row.expires_at <= now()) return null;
  const timestamp = now();
  await db.batch([
    { sql: `UPDATE auth_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL`, params: [timestamp, row.id] },
    {
      sql: `UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?`,
      params: [timestamp, timestamp, row.user_id],
    },
  ]);
  return db.first<UserRow>(`SELECT * FROM users WHERE id = ?`, [row.user_id]);
}

export async function createPasswordReset(db: Db, email: string): Promise<{ user: UserRow; token: string } | null> {
  const normalized = normalizeEmail(email);
  const user = await db.first<UserRow>(`SELECT * FROM users WHERE email_normalized = ? LIMIT 1`, [normalized]);
  if (!user || user.status !== "active") return null;
  const token = await createAuthToken(db, user.id, "reset_password", RESET_TTL);
  return { user, token };
}

export async function resetPasswordWithToken(db: Db, token: string, password: string): Promise<UserRow | null> {
  assertPasswordPolicy(password);
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await db.first<{ id: string; user_id: string; expires_at: number; used_at: number | null }>(
    `SELECT id, user_id, expires_at, used_at FROM auth_tokens WHERE token_hash = ? AND kind = 'reset_password' LIMIT 1`,
    [hash],
  );
  if (!row || row.used_at || row.expires_at <= now()) return null;
  const passwordHash = await hashPassword(password);
  const timestamp = now();
  await db.batch([
    { sql: `UPDATE auth_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL`, params: [timestamp, row.id] },
    { sql: `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`, params: [passwordHash, timestamp, row.user_id] },
    { sql: `DELETE FROM sessions WHERE user_id = ?`, params: [row.user_id] },
  ]);
  return db.first<UserRow>(`SELECT * FROM users WHERE id = ?`, [row.user_id]);
}

export async function changePassword(
  db: Db,
  user: UserRow,
  currentPassword: string,
  nextPassword: string,
): Promise<void> {
  assertPasswordPolicy(nextPassword);
  const valid = await verifyPassword(currentPassword, user.password_hash);
  if (!valid) throw new ApiError(400, "Current password is incorrect.", "INVALID_CREDENTIALS");
  const passwordHash = await hashPassword(nextPassword);
  await db.run(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`, [passwordHash, now(), user.id]);
}
