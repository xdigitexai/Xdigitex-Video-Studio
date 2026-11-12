/**
 * Backwards-compatible generation endpoint.
 *
 * The original Studio posted `mode: "generate" | "edit"` without a model ID.
 * That shape is still accepted and mapped onto the provider-independent model
 * catalogue, while new clients can send an explicit modelId/capability.
 */
import { guardMutation, requireUser } from "@/lib/server/context";
import { getEntitlements } from "@/lib/server/plans";
import { listCustomerModels, publicModel } from "@/lib/server/models";
import { createGeneration, generationView, quoteGeneration, refreshGeneration, isTerminalStatus, type GenerationRow } from "@/lib/server/generation";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { clampInt, safeString } from "@/lib/server/util";

export const dynamic = "force-dynamic";

async function pickLegacyModel(
  db: Parameters<typeof listCustomerModels>[0],
  userId: string,
  capability: "text_to_video" | "video_to_video",
) {
  const entitlements = await getEntitlements(db, userId);
  const models = await listCustomerModels(db, {
    capability,
    planModelIds: entitlements.plan ? entitlements.modelIds : [],
  });
  const allowed = models.filter((model) => model.planAllowed);
  if (!entitlements.plan) {
    throw new ApiError(402, "Choose a subscription plan to start generating.", "SUBSCRIPTION_REQUIRED");
  }
  if (!allowed.length) {
    throw new ApiError(403, "Your plan does not include a model for this action.", "MODEL_NOT_IN_PLAN");
  }
  if (capability === "video_to_video") {
    return allowed.find((model) => model.isDefaultVideo) ?? allowed[0];
  }
  return (
    allowed.find((model) => model.isDefaultVideo) ??
    allowed.find((model) => model.code === "gen4.5") ??
    allowed[0]
  );
}

export async function POST(request: Request) {
  try {
    const { db, env, actor } = await requireUser(request);
    await guardMutation(request, db, "generate", 12, 60_000);
    const body = await readJson<Record<string, unknown>>(request);
    const projectId = safeString(body.projectId, 80);
    if (!projectId) throw new ApiError(400, "Choose a project.", "PROJECT_REQUIRED");
    const prompt = safeString(body.prompt, 2000);
    if (prompt.length < 5) throw new ApiError(400, "Describe what you want to create.", "PROMPT_REQUIRED");

    const explicitModelId = safeString(body.modelId, 80);
    const mode = body.mode === "edit" ? "edit" : "generate";
    const capability = explicitModelId
      ? safeString(body.capability, 40)
      : mode === "edit"
        ? "video_to_video"
        : "text_to_video";
    const model = explicitModelId
      ? { id: explicitModelId }
      : await pickLegacyModel(db, actor.user.id, capability as "text_to_video" | "video_to_video");
    const durationSeconds = clampInt(
      body.durationSeconds ?? body.duration,
      1,
      60,
      mode === "edit" ? Math.max(2, Math.ceil(Number(body.duration) || 2)) : 5,
    );
    const sourceAssetId = body.sourceAssetId ? safeString(body.sourceAssetId, 80) : null;

    const input = {
      projectId,
      modelId: model.id,
      capability,
      prompt,
      durationSeconds,
      aspect: safeString(body.aspect, 10) || "16:9",
      resolution: safeString(body.resolution, 30),
      imageCount: 1,
      sourceAssetId,
      idempotencyKey: body.idempotencyKey ? safeString(body.idempotencyKey, 120) : null,
      confirmedCredits: body.confirmedCredits === undefined ? undefined : Number(body.confirmedCredits),
    };

    if (body.confirmedCredits === undefined || body.confirmedCredits === null) {
      const { quote, model: quotedModel } = await quoteGeneration(db, actor.user.id, input);
      throw new ApiError(409, "Review and confirm the estimated credit cost before generating.", "PRICE_CONFIRMATION_REQUIRED", {
        credits: quote.credits,
        priceLabel: `$${(quote.sellingPriceMicros / 1_000_000).toFixed(2)}`,
        model: publicModel(quotedModel),
      });
    }

    const created = await createGeneration(db, env, actor.user.id, input);
    return json({ generation: created.generation, reused: created.reused }, created.reused ? 200 : 202);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const { db, env, actor } = await requireUser(request);
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") || "";
    if (!projectId) throw new ApiError(400, "projectId is required.", "PROJECT_REQUIRED");
    const project = await db.first<{ id: string }>(
      `SELECT id FROM projects WHERE id = ? AND owner_id = ? LIMIT 1`,
      [projectId, actor.user.id],
    );
    if (!project) throw new ApiError(404, "Project not found.", "PROJECT_NOT_FOUND");
    const row = await db.first<GenerationRow>(
      `SELECT * FROM generations WHERE project_id = ? AND owner_id = ? ORDER BY created_at DESC LIMIT 1`,
      [projectId, actor.user.id],
    );
    if (!row) return json({ generation: null });
    let generation = await generationView(db, row);
    if (!isTerminalStatus(row.status) && row.provider_task_id) {
      try {
        generation = await refreshGeneration(db, env, row.id, actor.user.id);
      } catch {
        generation = { ...generation, statusCheckError: true };
      }
    }
    return json({ generation });
  } catch (error) {
    return errorResponse(error);
  }
}
