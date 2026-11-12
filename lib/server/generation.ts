import type { Db } from "./db";
import type { RuntimeEnv } from "./runtime";
import { ApiError } from "./http";
import { now, newId, parseJson, safeString, clampInt } from "./util";
import { getEntitlements, limitReached, type Entitlements } from "./plans";
import { getModelView, getProvider, type ModelView } from "./models";
import { getPricingSettings, listPricingOverrides, overrideConfig } from "./settings";
import { quoteCharge, type ChargeQuote, type GenerationType, type ModelPricingConfig } from "./pricing";
import { getWallet, reserveCredits, releaseReservation, settleCredits } from "./credits";
import { resolveProviderRuntime } from "./providers/service";
import { recordProviderError } from "./audit";
import {
  ProviderError,
  base64ToBytes,
  guessExtension,
  type GenerationRequest,
  type JobStatus,
  type ProviderOutput,
  type SourceMedia,
} from "./providers/types";

export const VIDEO_CAPABILITIES = ["text_to_video", "image_to_video", "video_to_video"] as const;
export const IMAGE_CAPABILITIES = ["text_to_image", "image_edit", "image_variations"] as const;

export function isVideoCapability(capability: string): boolean {
  return (VIDEO_CAPABILITIES as readonly string[]).includes(capability);
}

export function isImageCapability(capability: string): boolean {
  return (IMAGE_CAPABILITIES as readonly string[]).includes(capability);
}

export interface GenerationRow {
  id: string;
  project_id: string;
  owner_id: string;
  provider_task_id: string;
  status: string;
  mode: string;
  prompt: string;
  duration: number;
  aspect: string;
  output_asset_id: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  provider_id: string | null;
  model_id: string | null;
  capability: string;
  settings: string;
  progress: number;
  credits_reserved: number;
  credits_charged: number;
  pricing_snapshot_id: string | null;
  billing_status: string;
  idempotency_key: string | null;
  submitted_at: number | null;
  completed_at: number | null;
  attempts: number;
}

export interface GenerationView {
  id: string;
  projectId: string;
  status: string;
  capability: string;
  providerName: string | null;
  modelName: string | null;
  prompt: string;
  duration: number;
  aspect: string;
  resolution: string | null;
  progress: number;
  creditsReserved: number;
  creditsCharged: number;
  outputAssetId: string | null;
  outputUrl: string | null;
  outputContentType: string | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
  statusCheckError?: boolean;
}

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "CANCELED"]);

export function isTerminalStatus(status: string): boolean {
  return TERMINAL.has(status);
}

export function pricingModelFromView(model: ModelView): ModelPricingConfig {
  const meta = model.pricingMeta as {
    resolutionMultipliers?: Record<string, number>;
    sizeMultipliers?: Record<string, number>;
    outputMultiplier?: number;
  };
  return {
    id: model.id,
    providerId: model.providerId,
    pricingUnit: model.pricingUnit as ModelPricingConfig["pricingUnit"],
    unitCostMicros: model.unitCostMicros,
    minChargeMicros: model.minChargeMicros,
    pricingMeta: meta,
    isEstimated: model.isEstimated,
  };
}

export interface GenerationInput {
  projectId: string;
  modelId: string;
  capability: string;
  prompt: string;
  durationSeconds?: number;
  aspect?: string;
  resolution?: string;
  imageCount?: number;
  sourceAssetId?: string | null;
  idempotencyKey?: string | null;
  confirmedCredits?: number;
}

export interface QuoteResult {
  model: ModelView;
  quote: ChargeQuote;
  entitlements: Entitlements;
  capability: GenerationType;
}

function normaliseAspect(value: unknown): string {
  return ["16:9", "9:16", "1:1"].includes(String(value)) ? String(value) : "16:9";
}

export async function assertGenerationAllowed(
  db: Db,
  entitlements: Entitlements,
  input: {
    capability: GenerationType;
    durationSeconds: number;
    resolution: string;
    imageCount: number;
    modelAllowed: boolean;
  },
): Promise<void> {
  if (!entitlements.plan) {
    throw new ApiError(
      402,
      "Choose a subscription plan to start generating.",
      "SUBSCRIPTION_REQUIRED",
    );
  }
  if (!input.modelAllowed) {
    throw new ApiError(
      403,
      "Your plan does not include this model. Upgrade to unlock it.",
      "MODEL_NOT_IN_PLAN",
    );
  }
  if (entitlements.usage.concurrentJobs >= entitlements.limits.maxConcurrentJobs) {
    throw new ApiError(
      429,
      `Your plan allows ${entitlements.limits.maxConcurrentJobs} concurrent generation${
        entitlements.limits.maxConcurrentJobs === 1 ? "" : "s"
      }. Wait for a job to finish.`,
      "CONCURRENCY_LIMIT",
    );
  }
  if (isVideoCapability(input.capability)) {
    if (limitReached(entitlements.limits.videoLimit, entitlements.usage.videos)) {
      throw new ApiError(403, "You have used all video generations in this billing period.", "VIDEO_LIMIT");
    }
    if (input.durationSeconds > entitlements.limits.maxVideoDurationSeconds) {
      throw new ApiError(
        403,
        `Your plan supports videos up to ${entitlements.limits.maxVideoDurationSeconds} seconds.`,
        "DURATION_LIMIT",
      );
    }
    if (
      entitlements.limits.resolutions.length &&
      !entitlements.limits.resolutions.includes(input.resolution)
    ) {
      throw new ApiError(
        403,
        `Your plan supports ${entitlements.limits.resolutions.join(", ")}.`,
        "RESOLUTION_LIMIT",
      );
    }
  }
  if (isImageCapability(input.capability)) {
    if (limitReached(entitlements.limits.imageLimit, entitlements.usage.images)) {
      throw new ApiError(403, "You have used all image generations in this billing period.", "IMAGE_LIMIT");
    }
  }
}

export async function quoteGeneration(
  db: Db,
  userId: string,
  input: GenerationInput,
  entitlementsOverride?: Entitlements,
): Promise<QuoteResult> {
  if (!input.projectId) throw new ApiError(400, "Choose a project.", "PROJECT_REQUIRED");
  if (!input.modelId) throw new ApiError(400, "Choose an AI model.", "MODEL_REQUIRED");
  const capability = input.capability as GenerationType;
  const model = await getModelView(db, input.modelId);
  if (!model) throw new ApiError(404, "Model not found.", "MODEL_NOT_FOUND");
  if (!model.isActive || !model.providerEnabled) {
    throw new ApiError(409, "This model is currently unavailable.", "MODEL_UNAVAILABLE");
  }
  if (!model.capabilities.includes(capability)) {
    throw new ApiError(400, `${model.displayName} does not support ${capability}.`, "CAPABILITY_UNSUPPORTED");
  }
  const entitlements = entitlementsOverride ?? (await getEntitlements(db, userId));
  const settingsRow = await getPricingSettings(db);
  const overrides = (await listPricingOverrides(db)).map(overrideConfig);

  const durationSeconds = clampInt(input.durationSeconds, 1, 300, 5);
  if (isVideoCapability(capability) && durationSeconds > model.maxDurationSeconds) {
    throw new ApiError(
      400,
      `${model.displayName} supports videos up to ${model.maxDurationSeconds} seconds.`,
      "MODEL_DURATION_LIMIT",
    );
  }
  const imageCount = clampInt(input.imageCount, 1, 4, 1);
  const resolution =
    safeString(input.resolution, 30) ||
    model.resolutions[0] ||
    (isVideoCapability(capability) ? entitlements.limits.resolutions[0] || "720p" : "1024x1024");

  await assertGenerationAllowed(db, entitlements, {
    capability,
    durationSeconds,
    resolution,
    imageCount,
    modelAllowed: entitlements.modelIds.includes(model.id),
  });

  const quote = quoteCharge(
    {
      defaultMarginBps: settingsRow.default_margin_bps,
      minChargeMicros: settingsRow.min_charge_micros,
      creditValueMicros: settingsRow.credit_value_micros,
      version: settingsRow.version,
    },
    overrides,
    pricingModelFromView(model),
    {
      userId,
      planId: entitlements.plan?.id ?? null,
      providerId: model.providerId,
      modelId: model.id,
      generationType: capability,
      durationSeconds,
      imageCount,
      resolution,
      outputs: 1,
    },
  );
  const wallet = await getWallet(db, userId);
  if (wallet.available < quote.credits) {
    throw new ApiError(
      402,
      `You need ${quote.credits} credits for this generation, but only ${wallet.available} are available.`,
      "INSUFFICIENT_CREDITS",
      { required: quote.credits, available: wallet.available },
    );
  }
  return { model, quote, entitlements, capability };
}

async function sourceMediaFor(
  db: Db,
  env: RuntimeEnv,
  input: { ownerId: string; projectId: string; assetId: string; capability: string },
): Promise<SourceMedia> {
  const asset = await db.first<{
    id: string;
    owner_id: string;
    project_id: string;
    object_key: string;
    file_name: string;
    content_type: string;
    byte_size: number;
  }>(`SELECT * FROM assets WHERE id = ? AND owner_id = ? AND project_id = ? LIMIT 1`, [
    input.assetId,
    input.ownerId,
    input.projectId,
  ]);
  if (!asset) throw new ApiError(404, "The source media was not found in this project.", "SOURCE_NOT_FOUND");
  if (!env.BUCKET) throw new ApiError(503, "Media storage is not configured.", "STORAGE_MISSING");
  const bucket = env.BUCKET;
  const needsVideo = input.capability === "video_to_video";
  const needsImage = input.capability === "image_to_video" || input.capability === "image_edit";
  if (needsVideo && !asset.content_type.startsWith("video/")) {
    throw new ApiError(400, "This model needs a video source.", "SOURCE_UNSUPPORTED");
  }
  if (needsImage && !asset.content_type.startsWith("image/")) {
    throw new ApiError(400, "This model needs an image source.", "SOURCE_UNSUPPORTED");
  }
  return {
    fileName: asset.file_name,
    contentType: asset.content_type,
    byteSize: asset.byte_size,
    async bytes() {
      const object = await bucket.get(asset.object_key);
      if (!object) throw new ApiError(404, "The source file is missing from storage.", "SOURCE_NOT_FOUND");
      if (asset.byte_size > 30_000_000) {
        throw new ApiError(413, "This source is too large for this provider. Use a smaller file.", "SOURCE_TOO_LARGE");
      }
      return new Uint8Array(await object.arrayBuffer());
    },
    async stream() {
      const object = await bucket.get(asset.object_key);
      if (!object?.body) throw new ApiError(404, "The source file is missing from storage.", "SOURCE_NOT_FOUND");
      return object.body;
    },
  };
}

function generationRequest(input: {
  model: ModelView;
  capability: GenerationType;
  prompt: string;
  durationSeconds: number;
  aspect: string;
  resolution: string;
  imageCount: number;
  source?: SourceMedia;
}): GenerationRequest {
  return {
    modelCode: input.model.code,
    capability: input.capability,
    prompt: input.prompt,
    durationSeconds: input.durationSeconds,
    aspect: input.aspect,
    resolution: input.resolution,
    imageCount: input.imageCount,
    source: input.source,
  };
}

async function insertSnapshot(
  db: Db,
  input: {
    generationId: string;
    userId: string;
    model: ModelView;
    capability: string;
    quote: ChargeQuote;
    configVersion: number;
  },
): Promise<string> {
  const id = newId("prc");
  await db.run(
    `INSERT INTO pricing_snapshots (id, generation_id, user_id, provider_id, model_id, capability, units, unit_kind,
       provider_cost_micros, margin_bps, selling_price_micros, credits_charged, credit_value_micros, currency,
       estimated, config_version, applied_rule, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?)`,
    [
      id,
      input.generationId,
      input.userId,
      input.model.providerId,
      input.model.id,
      input.capability,
      input.quote.units,
      input.quote.unitKind,
      input.quote.providerCostMicros,
      input.quote.marginBps,
      input.quote.sellingPriceMicros,
      input.quote.credits,
      input.quote.creditValueMicros,
      input.quote.estimated ? 1 : 0,
      input.configVersion,
      JSON.stringify(input.quote.appliedRule),
      now(),
    ],
  );
  return id;
}

async function insertUsage(
  db: Db,
  input: {
    generationId: string;
    providerId: string;
    modelId: string;
    units: number;
    unitKind: string;
    estimatedCostMicros: number;
  },
): Promise<void> {
  await db.run(
    `INSERT INTO generation_usage (id, generation_id, provider_id, model_id, units, unit_kind, estimated_cost_micros, actual_cost_micros, provider_reference, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, '{}', ?)`,
    [
      newId("usage"),
      input.generationId,
      input.providerId,
      input.modelId,
      input.units,
      input.unitKind,
      input.estimatedCostMicros,
      now(),
    ],
  );
}

export interface CreatedGeneration {
  generation: GenerationView;
  reused: boolean;
}

export async function createGeneration(
  db: Db,
  env: RuntimeEnv,
  userId: string,
  input: GenerationInput,
): Promise<CreatedGeneration> {
  if (typeof input.prompt !== "string" || input.prompt.trim().length < 5) {
    throw new ApiError(400, "Describe what you want to create.", "PROMPT_REQUIRED");
  }
  if (input.prompt.length > 2000) throw new ApiError(400, "Prompt is too long.", "PROMPT_TOO_LONG");
  const project = await db.first<{ id: string }>(`SELECT id FROM projects WHERE id = ? AND owner_id = ? LIMIT 1`, [
    input.projectId,
    userId,
  ]);
  if (!project) throw new ApiError(404, "Project not found.", "PROJECT_NOT_FOUND");

  const idempotencyKey = input.idempotencyKey ? safeString(input.idempotencyKey, 120) : null;
  if (idempotencyKey) {
    const existing = await db.first<GenerationRow>(`SELECT * FROM generations WHERE idempotency_key = ? LIMIT 1`, [
      idempotencyKey,
    ]);
    if (existing && existing.owner_id === userId) {
      return { generation: await generationView(db, existing), reused: true };
    }
  }

  const { model, quote, entitlements, capability } = await quoteGeneration(db, userId, input);
  if (input.confirmedCredits !== undefined && input.confirmedCredits !== quote.credits) {
    throw new ApiError(
      409,
      "The price changed since you reviewed it. Review the new estimate and confirm again.",
      "PRICE_CHANGED",
      { credits: quote.credits },
    );
  }

  const settingsRow = await getPricingSettings(db);
  const generationId = newId("gen");
  const reservation = await reserveCredits(db, { userId, generationId, amount: quote.credits });
  if (!reservation.ok) {
    throw new ApiError(
      402,
      `You need ${quote.credits} credits for this generation, but only ${reservation.available} are available.`,
      "INSUFFICIENT_CREDITS",
      { required: quote.credits, available: reservation.available },
    );
  }

  const timestamp = now();
  const durationSeconds = clampInt(
    input.durationSeconds,
    1,
    Math.max(1, model.maxDurationSeconds),
    Math.min(5, model.maxDurationSeconds),
  );
  const resolution =
    safeString(input.resolution, 30) ||
    model.resolutions[0] ||
    (isVideoCapability(capability) ? entitlements.limits.resolutions[0] || "720p" : "1024x1024");
  const aspect = normaliseAspect(input.aspect);
  const settings = JSON.stringify({
    aspect,
    resolution,
    imageCount: clampInt(input.imageCount, 1, 4, 1),
    sourceAssetId: input.sourceAssetId ?? null,
  });
  const prompt = input.prompt.trim();

  try {
    await db.run(
      `INSERT INTO generations (id, project_id, owner_id, provider_task_id, status, mode, prompt, duration, aspect,
         output_asset_id, error, created_at, updated_at, provider_id, model_id, capability, settings, progress,
         credits_reserved, credits_charged, pricing_snapshot_id, billing_status, idempotency_key, submitted_at,
         completed_at, attempts)
       VALUES (?, ?, ?, '', 'SUBMITTING', ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, 0, ?, 0, NULL, 'reserved', ?, NULL, NULL, 0)`,
      [
        generationId,
        input.projectId,
        userId,
        isVideoCapability(capability) ? "generate" : "image",
        prompt,
        durationSeconds,
        aspect,
        timestamp,
        timestamp,
        model.providerId,
        model.id,
        capability,
        settings,
        quote.credits,
        idempotencyKey,
      ],
    );
    const snapshotId = await insertSnapshot(db, {
      generationId,
      userId,
      model,
      capability,
      quote,
      configVersion: settingsRow.version,
    });
    await db.run(`UPDATE generations SET pricing_snapshot_id = ? WHERE id = ?`, [snapshotId, generationId]);
    await insertUsage(db, {
      generationId,
      providerId: model.providerId,
      modelId: model.id,
      units: quote.units,
      unitKind: quote.unitKind,
      estimatedCostMicros: quote.providerCostMicros,
    });
  } catch (error) {
    await releaseReservation(db, { generationId, userId });
    await db.run(
      `UPDATE generations SET status = 'FAILED', error = ?, billing_status = 'released', updated_at = ? WHERE id = ?`,
      [
        error instanceof Error ? error.message.slice(0, 400) : "Could not prepare the generation.",
        now(),
        generationId,
      ],
    );
    throw error;
  }

  let source: SourceMedia | undefined;
  let runtime;
  try {
    if (input.sourceAssetId) {
      source = await sourceMediaFor(db, env, {
        ownerId: userId,
        projectId: input.projectId,
        assetId: input.sourceAssetId,
        capability,
      });
    }
    runtime = await resolveProviderRuntime(db, model.providerId, env);
    const request = generationRequest({
      model,
      capability,
      prompt,
      durationSeconds,
      aspect,
      resolution,
      imageCount: clampInt(input.imageCount, 1, 4, 1),
      source,
    });
    const submitted = await runtime.adapter.submit(runtime.context, request);
    const submittedAt = now();
    if (submitted.immediateResult) {
      await db.run(
        `UPDATE generations SET provider_task_id = ?, status = 'PROCESSING', submitted_at = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?`,
        [submitted.externalId, submittedAt, submittedAt, generationId],
      );
      await handleProviderResult(db, env, generationId, submitted.immediateResult, request);
    } else {
      await db.run(
        `UPDATE generations SET provider_task_id = ?, status = ?, submitted_at = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?`,
        [submitted.externalId, submitted.status === "queued" ? "QUEUED" : "PROCESSING", submittedAt, submittedAt, generationId],
      );
    }
    const row = await getGenerationRow(db, generationId);
    return { generation: await generationView(db, row!), reused: false };
  } catch (error) {
    const providerError =
      error instanceof ProviderError
        ? error
        : new ProviderError(502, error instanceof Error ? error.message : "The AI provider failed.", "", "PROVIDER_ERROR");
    await failGeneration(db, generationId, userId, providerError.message, providerError);
    throw new ApiError(
      502,
      `${providerError.message}${providerError.detail ? ` ${providerError.detail}` : ""}`.slice(0, 500),
      providerError.code,
    );
  }
}

export async function getGenerationRow(db: Db, id: string): Promise<GenerationRow | null> {
  return db.first<GenerationRow>(`SELECT * FROM generations WHERE id = ?`, [id]);
}

export async function generationView(db: Db, row: GenerationRow): Promise<GenerationView> {
  const settings = parseJson<{ resolution?: string }>(row.settings, {});
  const [provider, model, asset] = await Promise.all([
    row.provider_id ? getProvider(db, row.provider_id) : Promise.resolve(null),
    row.model_id ? db.first<{ display_name: string }>(`SELECT display_name FROM ai_models WHERE id = ?`, [row.model_id]) : Promise.resolve(null),
    row.output_asset_id
      ? db.first<{ content_type: string }>(`SELECT content_type FROM assets WHERE id = ?`, [row.output_asset_id])
      : Promise.resolve(null),
  ]);
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    capability: row.capability,
    providerName: provider?.name ?? (row.provider_id ? null : "Runway"),
    modelName: model?.display_name ?? null,
    prompt: row.prompt,
    duration: row.duration,
    aspect: row.aspect,
    resolution: settings.resolution ?? null,
    progress: row.progress,
    creditsReserved: row.credits_reserved,
    creditsCharged: row.credits_charged,
    outputAssetId: row.output_asset_id,
    outputUrl: row.output_asset_id ? `/api/assets/${row.output_asset_id}` : null,
    outputContentType: asset?.content_type ?? null,
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

async function downloadOutput(
  env: RuntimeEnv,
  output: ProviderOutput,
): Promise<{ bytes: Uint8Array; contentType: string; extension: string }> {
  if (output.base64) {
    return {
      bytes: base64ToBytes(output.base64),
      contentType: output.contentType,
      extension: output.extension || guessExtension(output.contentType),
    };
  }
  if (!output.url) throw new Error("The provider returned an output without a URL.");
  const response = await fetch(output.url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body) {
    throw new Error(`The generated file could not be downloaded (${response.status}).`);
  }
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 512_000_000) throw new Error("The generated file is larger than the 512 MB limit.");
  const buffer = await response.arrayBuffer();
  return {
    bytes: new Uint8Array(buffer),
    contentType: response.headers.get("content-type") || output.contentType,
    extension: output.extension || guessExtension(output.contentType),
  };
}

async function handleProviderResult(
  db: Db,
  env: RuntimeEnv,
  generationId: string,
  result: JobStatus,
  request: GenerationRequest,
): Promise<void> {
  const row = await getGenerationRow(db, generationId);
  if (!row) return;
  if (isTerminalStatus(row.status) && row.status === "SUCCEEDED") return;

  if (result.state === "failed" || result.state === "canceled") {
    await failGeneration(
      db,
      generationId,
      row.owner_id,
      result.error || (result.state === "canceled" ? "Generation was cancelled." : "The provider could not complete this generation."),
      null,
      result.state === "canceled" ? "CANCELED" : "FAILED",
    );
    return;
  }
  if (result.state !== "succeeded") {
    await db.run(
      `UPDATE generations SET status = ?, progress = ?, updated_at = ? WHERE id = ? AND status NOT IN ('SUCCEEDED','FAILED','CANCELED')`,
      [result.state === "processing" ? "PROCESSING" : "QUEUED", Math.min(99, result.progress ?? row.progress), now(), generationId],
    );
    return;
  }

  const outputs = result.outputs ?? [];
  if (!outputs.length) {
    await failGeneration(db, generationId, row.owner_id, "The provider finished without returning a file.");
    return;
  }
  if (!env.BUCKET) {
    await failGeneration(db, generationId, row.owner_id, "Output storage is not configured.");
    return;
  }
  const isVideo = isVideoCapability(row.capability);
  let firstAssetId: string | null = null;
  try {
    for (const output of outputs) {
      const downloaded = await downloadOutput(env, output);
      const assetId = newId("ast");
      const key = `users/${encodeURIComponent(row.owner_id)}/projects/${row.project_id}/${assetId}.${downloaded.extension}`;
      const stored = await env.BUCKET.put(key, downloaded.bytes, {
        httpMetadata: { contentType: downloaded.contentType },
      });
      const fileName = `generated-${new Date().toISOString().slice(0, 10)}-${assetId.slice(-6)}.${downloaded.extension}`;
      await db.run(
        `INSERT INTO assets (id, project_id, owner_id, object_key, file_name, content_type, byte_size, kind, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          assetId,
          row.project_id,
          row.owner_id,
          key,
          fileName,
          downloaded.contentType,
          stored.size,
          isVideo ? "generated" : "generated_image",
          now(),
        ],
      );
      firstAssetId ??= assetId;
    }
  } catch (error) {
    await failGeneration(
      db,
      generationId,
      row.owner_id,
      error instanceof Error ? error.message : "The generated file could not be saved.",
    );
    return;
  }

  const settlement = await settleCredits(db, {
    userId: row.owner_id,
    generationId,
    amount: row.credits_reserved,
    reference: `gen:${generationId}:consume`,
    description: "Generation charge",
    metadata: { capability: row.capability, modelId: row.model_id },
  });
  const timestamp = now();
  await db.run(
    `UPDATE generations SET status = 'SUCCEEDED', progress = 100, output_asset_id = ?, error = NULL,
       credits_charged = ?, billing_status = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`,
    [firstAssetId, settlement.charged, settlement.applied ? "settled" : "settlement_skipped", timestamp, timestamp, generationId],
  );
  if (result.actualCostMicros !== undefined && result.actualCostMicros !== null) {
    await db.run(
      `UPDATE generation_usage SET actual_cost_micros = ?, provider_reference = ? WHERE generation_id = ?`,
      [result.actualCostMicros, result.providerRef ?? null, generationId],
    );
  } else {
    await db.run(`UPDATE generation_usage SET provider_reference = ? WHERE generation_id = ?`, [
      result.providerRef ?? null,
      generationId,
    ]);
  }
  void request;
}

async function failGeneration(
  db: Db,
  generationId: string,
  userId: string,
  message: string,
  providerError: ProviderError | null = null,
  status: "FAILED" | "CANCELED" = "FAILED",
): Promise<void> {
  const row = await getGenerationRow(db, generationId);
  if (!row) return;
  await releaseReservation(db, { generationId, userId });
  const timestamp = now();
  await db.run(
    `UPDATE generations SET status = ?, error = ?, billing_status = 'released', completed_at = ?, updated_at = ?
     WHERE id = ? AND status NOT IN ('SUCCEEDED')`,
    [status, message.slice(0, 500), timestamp, timestamp, generationId],
  );
  if (providerError) {
    await recordProviderError(db, {
      providerId: row.provider_id,
      modelId: row.model_id,
      generationId,
      httpStatus: providerError.status,
      code: providerError.code,
      message: `${providerError.message} ${providerError.detail}`.trim(),
    });
  }
}

/** Polls the provider, stores outputs and settles credits. Safe to call repeatedly. */
export async function refreshGeneration(
  db: Db,
  env: RuntimeEnv,
  generationId: string,
  userId?: string,
): Promise<GenerationView> {
  const row = await getGenerationRow(db, generationId);
  if (!row) throw new ApiError(404, "Generation not found.", "GENERATION_NOT_FOUND");
  if (userId && row.owner_id !== userId) throw new ApiError(404, "Generation not found.", "GENERATION_NOT_FOUND");
  if (isTerminalStatus(row.status)) return generationView(db, row);

  // A crash between reservation and provider submission leaves a stuck job.
  if (row.status === "SUBMITTING" && !row.provider_task_id) {
    if (now() - row.updated_at > 5 * 60_000) {
      await failGeneration(db, row.id, row.owner_id, "The generation could not be submitted. Credits were released.");
      return generationView(db, (await getGenerationRow(db, row.id))!);
    }
    return generationView(db, row);
  }

  let providerId = row.provider_id;
  if (!providerId) {
    const runway = await getProvider(db, "runway");
    providerId = runway?.id ?? null;
  }
  if (!providerId) {
    await failGeneration(db, row.id, row.owner_id, "The provider for this job no longer exists.");
    return generationView(db, (await getGenerationRow(db, row.id))!);
  }
  const model = row.model_id ? await getModelView(db, row.model_id) : null;
  const runtime = await resolveProviderRuntime(db, providerId, env);
  const request: GenerationRequest = {
    modelCode: model?.code ?? "gen4.5",
    capability: row.capability as GenerationRequest["capability"],
    prompt: row.prompt,
    durationSeconds: row.duration,
    aspect: row.aspect,
  };
  let result: JobStatus;
  try {
    result = await runtime.adapter.getStatus(runtime.context, row.provider_task_id, request);
  } catch (error) {
    if (error instanceof ProviderError && error.status === 404) {
      await failGeneration(db, row.id, row.owner_id, "The provider no longer knows about this job.");
      return generationView(db, (await getGenerationRow(db, row.id))!);
    }
    throw error;
  }
  await handleProviderResult(db, env, row.id, result, request);
  return generationView(db, (await getGenerationRow(db, row.id))!);
}

export async function cancelGeneration(
  db: Db,
  env: RuntimeEnv,
  generationId: string,
  userId: string,
): Promise<GenerationView> {
  const row = await getGenerationRow(db, generationId);
  if (!row || row.owner_id !== userId) throw new ApiError(404, "Generation not found.", "GENERATION_NOT_FOUND");
  if (isTerminalStatus(row.status)) {
    throw new ApiError(409, "This generation has already finished.", "GENERATION_TERMINAL");
  }
  const providerId = row.provider_id ?? (await getProvider(db, "runway"))?.id;
  if (!providerId) throw new ApiError(409, "This job cannot be cancelled.", "CANCEL_UNSUPPORTED");
  try {
    const runtime = await resolveProviderRuntime(db, providerId, env);
    if (!runtime.adapter.supportsCancel || !runtime.adapter.cancel) {
      throw new ApiError(409, "This provider does not support cancellation.", "CANCEL_UNSUPPORTED");
    }
    await runtime.adapter.cancel(runtime.context, row.provider_task_id, {
      modelCode: "",
      capability: row.capability as GenerationRequest["capability"],
      prompt: row.prompt,
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(409, "The provider could not cancel this job.", "CANCEL_FAILED");
  }
  await failGeneration(db, generationId, userId, "Cancelled by you. Credits were released.", null, "CANCELED");
  return generationView(db, (await getGenerationRow(db, generationId))!);
}

export async function listGenerations(
  db: Db,
  options: {
    userId: string;
    projectId?: string;
    capability?: string;
    status?: string;
    limit?: number;
    offset?: number;
    since?: number;
  },
): Promise<GenerationRow[]> {
  const clauses = ["owner_id = ?"];
  const params: Array<string | number> = [options.userId];
  if (options.projectId) {
    clauses.push("project_id = ?");
    params.push(options.projectId);
  }
  if (options.capability) {
    clauses.push("capability = ?");
    params.push(options.capability);
  }
  if (options.status) {
    clauses.push("status = ?");
    params.push(options.status);
  }
  if (options.since) {
    clauses.push("created_at >= ?");
    params.push(options.since);
  }
  const limit = Math.min(100, Math.max(1, options.limit ?? 30));
  const offset = Math.max(0, options.offset ?? 0);
  return db.all<GenerationRow>(
    `SELECT * FROM generations WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
}

export interface DirectUsageInput {
  userId: string;
  projectId: string;
  modelId: string;
  capability: GenerationType;
  prompt: string;
  durationSeconds?: number;
  units?: number;
  description: string;
}

export interface DirectUsageResult<T> {
  result: T;
  generationId: string;
  credits: number;
}

/**
 * Bills and executes a synchronous provider call (transcription, prompt
 * enhancement) with the same reserve → execute → settle/refund guarantees as
 * asynchronous generation.
 */
export async function runDirectUsage<T>(
  db: Db,
  env: RuntimeEnv,
  input: DirectUsageInput,
  run: () => Promise<T>,
): Promise<DirectUsageResult<T>> {
  const { model, quote, entitlements, capability } = await quoteGeneration(db, input.userId, {
    projectId: input.projectId,
    modelId: input.modelId,
    capability: input.capability,
    prompt: input.prompt,
    durationSeconds: input.durationSeconds ?? 1,
  });
  void entitlements;
  const settingsRow = await getPricingSettings(db);
  const generationId = newId("gen");
  const reservation = await reserveCredits(db, { userId: input.userId, generationId, amount: quote.credits });
  if (!reservation.ok) {
    throw new ApiError(402, "Not enough credits for this request.", "INSUFFICIENT_CREDITS", {
      required: quote.credits,
      available: reservation.available,
    });
  }
  const timestamp = now();
  try {
    await db.run(
      `INSERT INTO generations (id, project_id, owner_id, provider_task_id, status, mode, prompt, duration, aspect,
         output_asset_id, error, created_at, updated_at, provider_id, model_id, capability, settings, progress,
         credits_reserved, credits_charged, pricing_snapshot_id, billing_status, idempotency_key, submitted_at,
         completed_at, attempts)
       VALUES (?, ?, ?, 'direct', 'PROCESSING', 'direct', ?, ?, '16:9', NULL, NULL, ?, ?, ?, ?, ?, '{}', 50, ?, 0, NULL, 'reserved', NULL, ?, NULL, 1)`,
      [
        generationId,
        input.projectId,
        input.userId,
        input.prompt.slice(0, 500),
        Math.max(1, Math.round(input.durationSeconds ?? 1)),
        timestamp,
        timestamp,
        model.providerId,
        model.id,
        capability,
        quote.credits,
        timestamp,
      ],
    );
    const snapshotId = await insertSnapshot(db, {
      generationId,
      userId: input.userId,
      model,
      capability,
      quote,
      configVersion: settingsRow.version,
    });
    await db.run(`UPDATE generations SET pricing_snapshot_id = ? WHERE id = ?`, [snapshotId, generationId]);
    await insertUsage(db, {
      generationId,
      providerId: model.providerId,
      modelId: model.id,
      units: quote.units,
      unitKind: quote.unitKind,
      estimatedCostMicros: quote.providerCostMicros,
    });
    const result = await run();
    const settlement = await settleCredits(db, {
      userId: input.userId,
      generationId,
      amount: quote.credits,
      reference: `gen:${generationId}:consume`,
      description: input.description,
    });
    const completedAt = now();
    await db.run(
      `UPDATE generations SET status = 'SUCCEEDED', progress = 100, credits_charged = ?, billing_status = ?,
         completed_at = ?, updated_at = ? WHERE id = ?`,
      [settlement.charged, settlement.applied ? "settled" : "settlement_skipped", completedAt, completedAt, generationId],
    );
    return { result, generationId, credits: quote.credits };
  } catch (error) {
    await failGeneration(
      db,
      generationId,
      input.userId,
      error instanceof Error ? error.message.slice(0, 400) : "The request failed.",
    );
    throw error;
  }
}

export async function sweepStuckGenerations(
  db: Db,
  env: RuntimeEnv,
  limit = 20,
): Promise<{ swept: number; refreshed: number }> {
  const stuck = await db.all<GenerationRow>(
    `SELECT * FROM generations WHERE status = 'SUBMITTING' AND updated_at < ? LIMIT ?`,
    [now() - 5 * 60_000, limit],
  );
  for (const row of stuck) {
    await failGeneration(db, row.id, row.owner_id, "Submission timed out. Credits were released.");
  }
  const active = await db.all<GenerationRow>(
    `SELECT * FROM generations WHERE status IN ('QUEUED','PROCESSING') AND provider_id IS NOT NULL
     ORDER BY updated_at ASC LIMIT ?`,
    [limit],
  );
  let refreshed = 0;
  for (const row of active) {
    try {
      await refreshGeneration(db, env, row.id);
      refreshed += 1;
    } catch {
      // Keep sweeping; one provider outage must not block the others.
    }
  }
  return { swept: stuck.length, refreshed };
}
