import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, id } from "./helpers/test-db";
import {
  authenticateAccount,
  changePassword,
  createPasswordReset,
  registerAccount,
  resetPasswordWithToken,
  verifyEmailToken,
} from "../lib/server/accounts";
import {
  createSession,
  destroySession,
  findUserByEmail,
  resolveActor,
  SESSION_COOKIE,
} from "../lib/server/auth";
import { ApiError } from "../lib/server/http";

const authConfig = { platformAuthEnabled: true, adminEmails: ["boss@xdigitex.test"], sessionDays: 30 };

test("registration hashes the password and requires email verification", async () => {
  const db = createTestDb();
  const { user, verificationToken } = await registerAccount(db, {
    email: "Creator@Studio.test",
    password: "correct-horse-battery",
    displayName: "Creator",
    emailVerificationRequired: true,
  });
  assert.equal(user.email_normalized, "creator@studio.test");
  assert.equal(user.email_verified_at, null);
  assert.ok(user.password_hash?.startsWith("pbkdf2$"));
  assert.ok(!user.password_hash?.includes("correct-horse-battery"));
  assert.ok(verificationToken);

  await assert.rejects(
    authenticateAccount(db, "creator@studio.test", "correct-horse-battery", { emailVerificationRequired: true }),
    (error: unknown) => error instanceof ApiError && error.code === "EMAIL_NOT_VERIFIED",
  );

  const verified = await verifyEmailToken(db, verificationToken!);
  assert.ok(verified?.email_verified_at);

  const login = await authenticateAccount(db, "creator@studio.test", "correct-horse-battery", {
    emailVerificationRequired: true,
  });
  assert.equal(login.user.id, user.id);
});

test("duplicate registration and wrong passwords are rejected", async () => {
  const db = createTestDb();
  await registerAccount(db, { email: "a@b.test", password: "password-123", emailVerificationRequired: false });
  await assert.rejects(
    registerAccount(db, { email: "A@B.test", password: "password-123", emailVerificationRequired: false }),
    (error: unknown) => error instanceof ApiError && error.code === "EMAIL_IN_USE",
  );
  await assert.rejects(
    authenticateAccount(db, "a@b.test", "wrong-password"),
    (error: unknown) => error instanceof ApiError && error.code === "INVALID_CREDENTIALS",
  );
  await assert.rejects(
    authenticateAccount(db, "nobody@b.test", "password-123"),
    (error: unknown) => error instanceof ApiError && error.code === "INVALID_CREDENTIALS",
  );
});

test("the first configured administrator email becomes a super administrator", async () => {
  const db = createTestDb();
  const { user } = await registerAccount(db, {
    email: "boss@xdigitex.test",
    password: "password-123",
    adminEmails: authConfig.adminEmails,
    emailVerificationRequired: false,
  });
  assert.equal(user.role, "super_admin");
});

test("sessions authenticate and expire", async () => {
  const db = createTestDb();
  const { user } = await registerAccount(db, {
    email: "session@studio.test",
    password: "password-123",
    emailVerificationRequired: false,
  });
  const session = await createSession(db, user.id, { ip: "127.0.0.1", userAgent: "test" });
  const headers = new Headers({ cookie: `${SESSION_COOKIE}=${session.token}` });
  const actor = await resolveActor(db, headers, authConfig);
  assert.equal(actor?.user.id, user.id);
  assert.equal(actor?.via, "session");

  await destroySession(db, session.token);
  assert.equal(await resolveActor(db, headers, authConfig), null);

  const stale = await createSession(db, user.id, {});
  await db.run(`UPDATE sessions SET expires_at = ? WHERE user_id = ?`, [Date.now() - 1000, user.id]);
  const staleHeaders = new Headers({ cookie: `${SESSION_COOKIE}=${stale.token}` });
  assert.equal(await resolveActor(db, staleHeaders, authConfig), null);
});

test("password reset is single use and revokes sessions", async () => {
  const db = createTestDb();
  const { user } = await registerAccount(db, {
    email: "reset@studio.test",
    password: "old-password-1",
    emailVerificationRequired: false,
  });
  await createSession(db, user.id, {});
  const reset = await createPasswordReset(db, "reset@studio.test");
  assert.ok(reset?.token);

  const updated = await resetPasswordWithToken(db, reset!.token, "new-password-2");
  assert.equal(updated?.id, user.id);
  await assert.rejects(
    authenticateAccount(db, "reset@studio.test", "old-password-1"),
    (error: unknown) => error instanceof ApiError && error.code === "INVALID_CREDENTIALS",
  );
  const login = await authenticateAccount(db, "reset@studio.test", "new-password-2");
  assert.equal(login.user.id, user.id);
  assert.equal(await resetPasswordWithToken(db, reset!.token, "another-password-3"), null);
  const sessions = await db.first<{ count: number }>(`SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?`, [user.id]);
  assert.equal(sessions?.count, 0);
});

test("password change verifies the current password", async () => {
  const db = createTestDb();
  const { user } = await registerAccount(db, {
    email: "change@studio.test",
    password: "old-password-1",
    emailVerificationRequired: false,
  });
  await assert.rejects(changePassword(db, user, "nope", "new-password-2"));
  await changePassword(db, user, "old-password-1", "new-password-2");
  const login = await authenticateAccount(db, "change@studio.test", "new-password-2");
  assert.equal(login.user.id, user.id);
});

test("platform header identity provisions a local user and claims legacy projects", async () => {
  const db = createTestDb();
  const legacyId = "chatgpt-user-42";
  const timestamp = Date.now();
  await db.run(
    `INSERT INTO projects (id, owner_id, name, prompt, aspect, duration, trim_start, trim_end, overlay_title, selected_asset_id, caption_enabled, captions, created_at, updated_at)
     VALUES (?, ?, 'Legacy project', '', '16:9', 5, 0, 0, '', NULL, 1, '[]', ?, ?)`,
    [id("prj"), legacyId, timestamp, timestamp],
  );
  const headers = new Headers({
    "oai-authenticated-user-id": legacyId,
    "oai-authenticated-user-email": "legacy@studio.test",
    "oai-authenticated-user-full-name": "Legacy%20User",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  const actor = await resolveActor(db, headers, authConfig);
  assert.ok(actor);
  assert.equal(actor?.user.email, "legacy@studio.test");
  assert.equal(actor?.via, "platform_header");
  const project = await db.first<{ owner_id: string }>(`SELECT owner_id FROM projects WHERE name = 'Legacy project'`);
  assert.equal(project?.owner_id, actor!.user.id);

  const again = await resolveActor(db, headers, authConfig);
  assert.equal(again?.user.id, actor!.user.id, "header identity maps to the same local user");
  const count = await db.first<{ count: number }>(`SELECT COUNT(*) AS count FROM users`);
  assert.equal(count?.count, 1);
});

test("platform header auth can be disabled", async () => {
  const db = createTestDb();
  const headers = new Headers({
    "oai-authenticated-user-id": "x",
    "oai-authenticated-user-email": "x@studio.test",
  });
  const actor = await resolveActor(db, headers, { ...authConfig, platformAuthEnabled: false });
  assert.equal(actor, null);
});

test("suspended users cannot authenticate", async () => {
  const db = createTestDb();
  const { user } = await registerAccount(db, {
    email: "susp@studio.test",
    password: "password-123",
    emailVerificationRequired: false,
  });
  await db.run(`UPDATE users SET status = 'suspended' WHERE id = ?`, [user.id]);
  await assert.rejects(
    authenticateAccount(db, "susp@studio.test", "password-123"),
    (error: unknown) => error instanceof ApiError && error.code === "ACCOUNT_SUSPENDED",
  );
  const session = await createSession(db, user.id, {});
  assert.equal(
    await resolveActor(db, new Headers({ cookie: `${SESSION_COOKIE}=${session.token}` }), authConfig),
    null,
  );
});

test("email lookup is case-insensitive", async () => {
  const db = createTestDb();
  await registerAccount(db, {
    email: "Mixed@Case.test",
    password: "password-123",
    emailVerificationRequired: false,
  });
  assert.ok(await findUserByEmail(db, "mixed@case.test"));
});
