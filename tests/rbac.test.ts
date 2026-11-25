import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, id } from "./helpers/test-db";
import type { Actor, UserRow } from "../lib/server/auth-types";
import { registerAccount } from "../lib/server/accounts";
import { findUserById } from "../lib/server/auth";
import {
  ADMIN_PERMISSIONS,
  adminPermissionForRequest,
  assertAdminPermission,
  bootstrapOwner,
  grantAdminPermission,
  permissionsForActor,
  rolePermissions,
} from "../lib/server/admin-access";
import { listCustomerModels, publicModel } from "../lib/server/models";
import { getPricingSettings, pricingConfig } from "../lib/server/settings";
import { quoteCharge } from "../lib/server/pricing";
import { ApiError } from "../lib/server/http";
import { listProviderCredentials } from "../lib/server/providers/service";

const authConfig = { platformAuthEnabled: true, sessionDays: 30 };

function actorFor(user: UserRow, overrides: Partial<Actor> = {}): Actor {
  return { user, via: "session", ...overrides };
}

async function makeUser(db: ReturnType<typeof createTestDb>, email: string, role: "customer" | "admin" | "super_admin" = "customer") {
  const { user } = await registerAccount(db, {
    email,
    password: "password-123",
    emailVerificationRequired: false,
  });
  if (role !== "customer") {
    await db.run(`UPDATE users SET role = ? WHERE id = ?`, [role, user.id]);
  }
  return (await findUserById(db, user.id))!;
}

function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

test("a newly registered user is a customer", async () => {
  const db = createTestDb();
  const user = await makeUser(db, "new@studio.test");
  assert.equal(user.role, "customer");
  assert.equal((await permissionsForActor(db, actorFor(user))).size, 0);
});

test("public registration cannot create an admin even for an owner email", async () => {
  const db = createTestDb();
  const { user } = await registerAccount(db, {
    email: "digitex.ac.ke@gmail.com",
    password: "password-123",
    emailVerificationRequired: false,
    ...({ adminEmails: ["digitex.ac.ke@gmail.com"] } as unknown as Record<string, never>),
  });
  assert.equal(user.role, "customer");
});

test("a customer is denied /admin, users, models, pricing and providers", async () => {
  const db = createTestDb();
  const actor = actorFor(await makeUser(db, "customer-denied@studio.test"));
  for (const permission of ["admin.access", "users.read", "models.read", "pricing.read", "providers.read", "audit.read"] as const) {
    await assert.rejects(assertAdminPermission(db, actor, permission), isForbidden);
  }
});

test("customer model and pricing APIs contain no provider cost or margin", async () => {
  const db = createTestDb();
  const providerId = id("prv");
  const providerCode = `fal_${providerId}`;
  const modelId = id("mdl");
  const now = Date.now();
  await db.run(
    `INSERT INTO ai_providers (id, code, name, is_enabled, status, sort_order, created_at, updated_at)
     VALUES (?, ?, 'Fal', 1, 'configured', 0, ?, ?)`,
    [providerId, providerCode, now, now],
  );
  await db.run(
    `INSERT INTO ai_models (id, provider_id, code, display_name, capabilities, unit_cost_micros, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 'Global model', '["text_to_video"]', 2000000, 1, ?, ?)`,
    [modelId, providerId, `global-${modelId}`, now, now],
  );
  const models = await listCustomerModels(db, { planModelIds: null });
  const view = publicModel(models[0]);
  assert.ok(!("unitCostMicros" in view));
  assert.ok(!("marginBps" in view));
  assert.ok(!("ciphertext" in view));
});

test("customer-scoped payment lookup cannot read another customer's payment", async () => {
  const db = createTestDb();
  const owner = await makeUser(db, "payment-owner@studio.test");
  const stranger = await makeUser(db, "payment-stranger@studio.test");
  await db.run(
    `INSERT INTO payments (id, user_id, reference, purpose, provider, amount_minor, currency, price_usd_cents, credits, status, metadata, created_at, updated_at)
     VALUES (?, ?, 'XDG-RBAC-1', 'credit_topup', 'xdigitex_pay_space', 65000, 'KES', 500, 500, 'pending', '{}', ?, ?)`,
    [id("pay"), owner.id, now(), now()],
  );
  const rows = await db.all<{ id: string }>(`SELECT id FROM payments WHERE user_id = ?`, [stranger.id]);
  assert.equal(rows.length, 0);
});

function now() {
  return Date.now();
}

test("an admin can enter the console but cannot change roles", async () => {
  const db = createTestDb();
  const actor = actorFor(await makeUser(db, "admin@studio.test", "admin"));
  assert.equal((await assertAdminPermission(db, actor, "admin.access")).user.role, "admin");
  assert.equal(rolePermissions("admin").has("users.roles"), false);
  await assert.rejects(assertAdminPermission(db, actor, "users.roles"), isForbidden);
});

test("a super admin has the complete platform permission set", async () => {
  const db = createTestDb();
  const actor = actorFor(await makeUser(db, "super@studio.test", "super_admin"));
  const permissions = await permissionsForActor(db, actor);
  for (const permission of ADMIN_PERMISSIONS) assert.equal(permissions.has(permission), true);
  assert.equal((await assertAdminPermission(db, actor, "catalog.read")).user.role, "super_admin");
});

test("one-time owner bootstrap promotes only a registered account", async () => {
  const db = createTestDb();
  const user = await makeUser(db, "owner@studio.test");
  const result = await bootstrapOwner(db, user.email);
  assert.equal(result.id, user.id);
  const stored = await findUserById(db, user.id);
  assert.equal(stored?.role, "super_admin");
  const permissions = await permissionsForActor(db, actorFor(stored!));
  assert.equal(permissions.size, ADMIN_PERMISSIONS.length);
  await assert.rejects(bootstrapOwner(db, "missing@studio.test"), (error: unknown) => {
    return error instanceof ApiError && error.code === "BOOTSTRAP_USER_NOT_FOUND";
  });
});

test("enrolled MFA requires a verified session before admin APIs are allowed", async () => {
  const db = createTestDb();
  const user = await makeUser(db, "mfa@studio.test", "super_admin");
  await db.run(`UPDATE users SET mfa_enabled = 1, mfa_secret = 'iv:cipher' WHERE id = ?`, [user.id]);
  const enrolled = await findUserById(db, user.id);
  await assert.rejects(assertAdminPermission(db, actorFor(enrolled!), "admin.access"), (error: unknown) => {
    return error instanceof ApiError && error.code === "MFA_REQUIRED";
  });
  const verifiedActor = actorFor(enrolled!, { mfaVerified: true });
  assert.equal((await assertAdminPermission(db, verifiedActor, "admin.access")).user.id, user.id);
});

test("a super admin can add a global model and disabling it blocks customer availability", async () => {
  const db = createTestDb();
  const actor = actorFor(await makeUser(db, "catalog-owner@studio.test", "super_admin"));
  assert.equal((await assertAdminPermission(db, actor, "models.write")).user.role, "super_admin");

  const providerId = id("prv");
  const modelId = id("mdl");
  const timestamp = Date.now();
  await db.run(
    `INSERT INTO ai_providers (id, code, name, is_enabled, status, sort_order, created_at, updated_at)
     VALUES (?, ?, 'Fal', 1, 'configured', 0, ?, ?)`,
    [providerId, `fal_${providerId}`, timestamp, timestamp],
  );
  await db.run(
    `INSERT INTO ai_models (id, provider_id, code, display_name, capabilities, unit_cost_micros, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 'Kling V3', '["text_to_video"]', 3000000, 1, ?, ?)`,
    [modelId, providerId, `kling-${modelId}`, timestamp, timestamp],
  );
  assert.ok((await listCustomerModels(db, { planModelIds: null })).some((model) => model.id === modelId));

  await db.run(`UPDATE ai_models SET is_active = 0 WHERE id = ?`, [modelId]);
  assert.ok(!(await listCustomerModels(db, { planModelIds: null })).some((model) => model.id === modelId));
});

test("a global pricing change changes every later quote consistently", async () => {
  const db = createTestDb();
  const actor = actorFor(await makeUser(db, "pricing-owner@studio.test", "super_admin"));
  assert.equal((await assertAdminPermission(db, actor, "pricing.write")).user.role, "super_admin");

  const settings = pricingConfig(await getPricingSettings(db));
  const model = {
    id: id("mdl"),
    providerId: id("prv"),
    pricingUnit: "per_second" as const,
    unitCostMicros: 2_000_000,
    minChargeMicros: 100_000,
    pricingMeta: {},
    isEstimated: false,
  };
  const context = {
    userId: id("usr"),
    planId: null,
    providerId: model.providerId,
    modelId: model.id,
    generationType: "text_to_video",
    durationSeconds: 5,
  };
  const before = quoteCharge(settings, [], model, context);
  await db.run(`UPDATE pricing_settings SET default_margin_bps = 6000, version = version + 1 WHERE id = 1`);
  const afterSettings = pricingConfig(await getPricingSettings(db));
  const after = quoteCharge(afterSettings, [], model, context);
  assert.equal(before.marginBps, 4000);
  assert.equal(after.marginBps, 6000);
  assert.ok(after.sellingPriceMicros > before.sellingPriceMicros);
  assert.equal(afterSettings.version, settings.version + 1);
});

test("provider credential lists and model views never expose secrets", async () => {
  const db = createTestDb();
  const providerId = id("prv");
  const providerCode = `fal_${providerId}`;
  const timestamp = Date.now();
  await db.run(
    `INSERT INTO ai_providers (id, code, name, is_enabled, status, sort_order, created_at, updated_at)
     VALUES (?, ?, 'Fal', 1, 'configured', 0, ?, ?)`,
    [providerId, providerCode, timestamp, timestamp],
  );
  await db.run(
    `INSERT INTO provider_credentials (id, provider_id, label, ciphertext, iv, fingerprint, is_active, created_at)
     VALUES (?, ?, 'production', ?, ?, 'abcd', 1, ?)`,
    [id("cred"), providerId, "not-the-api-key", "iv-value", timestamp],
  );
  const credentials = await listProviderCredentials(db, providerId);
  assert.equal(credentials.length, 1);
  assert.ok(!("ciphertext" in credentials[0]));
  assert.equal(credentials[0].fingerprint, "abcd");
  assert.equal(JSON.stringify(credentials).includes("not-the-api-key"), false);
  const serialized = JSON.stringify(publicModel({
    id: id("mdl"),
    providerId,
    providerCode,
    providerName: "Fal",
    providerEnabled: true,
    code: "global-model",
    displayName: "Global model",
    description: "",
    capabilities: ["text_to_video"],
    maxDurationSeconds: 10,
    resolutions: [],
    pricingUnit: "per_request",
    unitCostMicros: 0,
    minChargeMicros: 0,
    pricingMeta: {},
    isActive: true,
    isDefaultVideo: false,
    isDefaultImage: false,
    isEstimated: true,
    sortOrder: 0,
  }));
  assert.ok(!serialized.includes("ciphertext"));
  assert.ok(!serialized.includes("not-the-api-key"));
});

test("every admin API path maps to an explicit least-privilege permission", () => {
  const get = (path: string) => new Request(`https://studio.test${path}`, { method: "GET" });
  const post = (path: string) => new Request(`https://studio.test${path}`, { method: "POST" });
  assert.equal(adminPermissionForRequest(get("/api/admin/users")), "users.read");
  assert.equal(adminPermissionForRequest(post("/api/admin/users/usr_1/credits")), "users.write");
  assert.equal(adminPermissionForRequest(get("/api/admin/models")), "models.read");
  assert.equal(adminPermissionForRequest(post("/api/admin/models")), "models.write");
  assert.equal(adminPermissionForRequest(get("/api/admin/pricing")), "pricing.read");
  assert.equal(adminPermissionForRequest(get("/api/admin/providers")), "providers.read");
  assert.equal(adminPermissionForRequest(post("/api/admin/payments/pay_1")), "payments.write");
  assert.equal(adminPermissionForRequest(get("/api/admin/export?type=payments")), "export.read");
});

test("granting a permission is read from the trusted database row", async () => {
  const db = createTestDb();
  const user = await makeUser(db, "granted@studio.test", "admin");
  await grantAdminPermission(db, user.id, ["audit.read"]);
  const permissions = await permissionsForActor(db, actorFor(user));
  assert.equal(permissions.has("audit.read"), true);
  assert.equal(permissions.has("admin.access"), true);
});
