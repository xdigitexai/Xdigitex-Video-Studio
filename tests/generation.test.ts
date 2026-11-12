import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, id } from "./helpers/test-db";
import { activatePlan } from "../lib/server/plans";
import { grantCredits, getWallet } from "../lib/server/credits";
import {
  createGeneration,
  quoteGeneration,
  refreshGeneration,
  type GenerationInput,
} from "../lib/server/generation";
import { setDefaultModel } from "../lib/server/models";
import { ApiError } from "../lib/server/http";

type Db = ReturnType<typeof createTestDb>;

async function setup(db: Db) {
  const userId = id("usr");
  const timestamp = Date.now();
  await db.run(
    `INSERT INTO users (id, email, email_normalized, password_hash, display_name, role, status, email_verified_at, legacy_owner_id, last_login_at, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 'Tester', 'customer', 'active', ?, NULL, NULL, ?, ?)`,
    [userId, `${userId}@studio.test`, `${userId}@studio.test`, timestamp, timestamp, timestamp],
  );
  await activatePlan(db, { userId, planId: "plan_starter" });
  await grantCredits(db, {
    userId,
    credits: 1000,
    source: "subscription",
    reference: `test:${userId}:credits`,
    bumpLifetime: "granted",
  });
  const projectId = id("prj");
  await db.run(
    `INSERT INTO projects (id, owner_id, name, prompt, aspect, duration, trim_start, trim_end, overlay_title, selected_asset_id, caption_enabled, captions, created_at, updated_at)
     VALUES (?, ?, 'Test project', '', '16:9', 5, 0, 0, '', NULL, 1, '[]', ?, ?)`,
    [projectId, userId, timestamp, timestamp],
  );
  return { userId, projectId };
}

function quoteInput(projectId: string, overrides: Partial<GenerationInput> = {}): GenerationInput {
  return {
    projectId,
    modelId: "mdl_runway_gen45",
    capability: "text_to_video",
    prompt: "A cinematic ocean wave at golden hour",
    durationSeconds: 5,
    aspect: "16:9",
    resolution: "720p",
    imageCount: 1,
    ...overrides,
  };
}

test("a seeded plan prices a 5 second Gen-4.5 clip at 100 credits", async () => {
  const db = createTestDb();
  const { userId, projectId } = await setup(db);
  const { quote, model } = await quoteGeneration(db, userId, quoteInput(projectId));
  assert.equal(model.providerCode, "runway");
  assert.equal(quote.providerCostMicros, 600_000);
  assert.equal(quote.sellingPriceMicros, 1_000_000);
  assert.equal(quote.credits, 100);
  assert.equal(quote.marginBps, 4000);
});

test("a per-customer 20% margin changes the quote", async () => {
  const db = createTestDb();
  const { userId, projectId } = await setup(db);
  await db.run(
    `INSERT INTO pricing_overrides (id, label, user_id, plan_id, provider_id, model_id, generation_type, margin_bps, fixed_price_micros, min_charge_micros, priority, is_active, version, created_at, updated_at)
     VALUES (?, 'VIP', ?, NULL, NULL, NULL, NULL, 2000, NULL, NULL, 0, 1, 1, ?, ?)`,
    [id("rule"), userId, Date.now(), Date.now()],
  );
  const { quote } = await quoteGeneration(db, userId, quoteInput(projectId));
  assert.equal(quote.marginBps, 2000);
  assert.equal(quote.sellingPriceMicros, 750_000);
  assert.equal(quote.credits, 75);
});

test("a fixed selling price rule wins over margin", async () => {
  const db = createTestDb();
  const { userId, projectId } = await setup(db);
  await db.run(
    `INSERT INTO pricing_overrides (id, label, user_id, plan_id, provider_id, model_id, generation_type, margin_bps, fixed_price_micros, min_charge_micros, priority, is_active, version, created_at, updated_at)
     VALUES (?, 'Flat', ?, NULL, NULL, 'mdl_runway_gen45', NULL, NULL, 2000000, NULL, 0, 1, 1, ?, ?)`,
    [id("rule"), userId, Date.now(), Date.now()],
  );
  const { quote } = await quoteGeneration(db, userId, quoteInput(projectId));
  assert.equal(quote.sellingPriceMicros, 2_000_000);
  assert.equal(quote.credits, 200);
});

test("plan limits reject unsupported resolution and duration", async () => {
  const db = createTestDb();
  const { userId, projectId } = await setup(db);
  await assert.rejects(quoteGeneration(db, userId, quoteInput(projectId, { resolution: "1080p" })), (error: unknown) => {
    return error instanceof ApiError && error.code === "RESOLUTION_LIMIT";
  });
  await assert.rejects(quoteGeneration(db, userId, quoteInput(projectId, { durationSeconds: 15 })), (error: unknown) => {
    return error instanceof ApiError && error.code === "MODEL_DURATION_LIMIT";
  });
});

test("plan model access is enforced server-side", async () => {
  const db = createTestDb();
  const { userId, projectId } = await setup(db);
  await assert.rejects(
    quoteGeneration(
      db,
      userId,
      quoteInput(projectId, { modelId: "mdl_runway_aleph2", capability: "video_to_video", durationSeconds: 5 }),
    ),
    (error: unknown) => error instanceof ApiError && error.code === "MODEL_NOT_IN_PLAN",
  );
});

test("concurrent job limits are enforced before submitting", async () => {
  const db = createTestDb();
  const { userId, projectId } = await setup(db);
  const timestamp = Date.now();
  await db.run(
    `INSERT INTO generations (id, project_id, owner_id, provider_task_id, status, mode, prompt, duration, aspect, output_asset_id, error, created_at, updated_at)
     VALUES (?, ?, ?, 'task_1', 'PROCESSING', 'generate', 'busy', 5, '16:9', NULL, NULL, ?, ?)`,
    [id("gen"), projectId, userId, timestamp, timestamp],
  );
  await assert.rejects(quoteGeneration(db, userId, quoteInput(projectId)), (error: unknown) => {
    return error instanceof ApiError && error.code === "CONCURRENCY_LIMIT";
  });
});

test("insufficient credits are rejected with the required amount", async () => {
  const db = createTestDb();
  const { userId, projectId } = await setup(db);
  await db.run(`UPDATE credit_wallets SET balance = 5 WHERE user_id = ?`, [userId]);
  await assert.rejects(quoteGeneration(db, userId, quoteInput(projectId)), (error: unknown) => {
    return (
      error instanceof ApiError &&
      error.code === "INSUFFICIENT_CREDITS" &&
      (error.details as { required?: number }).required === 100
    );
  });
});

test("without a subscription, generation is refused", async () => {
  const db = createTestDb();
  const userId = id("usr");
  const timestamp = Date.now();
  await db.run(
    `INSERT INTO users (id, email, email_normalized, password_hash, display_name, role, status, email_verified_at, legacy_owner_id, last_login_at, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 'T', 'customer', 'active', ?, NULL, NULL, ?, ?)`,
    [userId, "nosub@studio.test", "nosub@studio.test", timestamp, timestamp, timestamp],
  );
  await assert.rejects(
    quoteGeneration(db, userId, quoteInput("prj_none")),
    (error: unknown) => error instanceof ApiError && error.code === "SUBSCRIPTION_REQUIRED",
  );
});

test("a failed provider submission releases the reservation and marks the job failed", async () => {
  const db = createTestDb();
  const { userId, projectId } = await setup(db);
  const before = await getWallet(db, userId);
  await assert.rejects(
    createGeneration(db, {} as Parameters<typeof createGeneration>[1], userId, {
      ...quoteInput(projectId),
      confirmedCredits: 100,
      idempotencyKey: "idem-test-1",
    }),
  );
  const after = await getWallet(db, userId);
  assert.equal(after.reserved, 0, "reservation is released when the provider cannot be reached");
  assert.equal(after.balance, before.balance, "no credits are consumed for an unsubmitted job");
  const job = await db.first<{ status: string; billing_status: string; error: string }>(
    `SELECT status, billing_status, error FROM generations WHERE owner_id = ? ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  assert.equal(job?.status, "FAILED");
  assert.equal(job?.billing_status, "released");
  assert.ok(job?.error);
});

test("a confirmed price that changed is rejected", async () => {
  const db = createTestDb();
  const { userId, projectId } = await setup(db);
  await assert.rejects(
    createGeneration(db, {} as Parameters<typeof createGeneration>[1], userId, {
      ...quoteInput(projectId),
      confirmedCredits: 1,
    }),
    (error: unknown) => error instanceof ApiError && error.code === "PRICE_CHANGED",
  );
});

test("generation ownership is enforced when polling", async () => {
  const db = createTestDb();
  const { userId, projectId } = await setup(db);
  const other = id("usr");
  const generationId = id("gen");
  const timestamp = Date.now();
  await db.run(
    `INSERT INTO generations (id, project_id, owner_id, provider_task_id, status, mode, prompt, duration, aspect, output_asset_id, error, created_at, updated_at)
     VALUES (?, ?, ?, 'task_x', 'SUCCEEDED', 'generate', 'done', 5, '16:9', NULL, NULL, ?, ?)`,
    [generationId, projectId, userId, timestamp, timestamp],
  );
  await assert.rejects(
    refreshGeneration(db, {} as Parameters<typeof refreshGeneration>[1], generationId, other),
    (error: unknown) => error instanceof ApiError && error.code === "GENERATION_NOT_FOUND",
  );
  const own = await refreshGeneration(db, {} as Parameters<typeof refreshGeneration>[1], generationId, userId);
  assert.equal(own.id, generationId);
  assert.equal(own.status, "SUCCEEDED");
});

test("the administrator can switch default models without a deployment", async () => {
  const db = createTestDb();
  await setDefaultModel(db, "mdl_runway_gen45", "video");
  await setDefaultModel(db, "mdl_openai_gpt_image_1", "image");
  const defaults = await db.all<{ id: string; is_default_video: number; is_default_image: number }>(
    `SELECT id, is_default_video, is_default_image FROM ai_models WHERE is_default_video = 1 OR is_default_image = 1`,
  );
  const video = defaults.filter((row) => row.is_default_video === 1);
  const image = defaults.filter((row) => row.is_default_image === 1);
  assert.equal(video.length, 1);
  assert.equal(video[0].id, "mdl_runway_gen45");
  assert.equal(image.length, 1);
  assert.equal(image[0].id, "mdl_openai_gpt_image_1");
});
