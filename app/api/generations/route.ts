import { guardMutation, requireUser } from "@/lib/server/context";
import { createGeneration, listGenerations, generationView, type GenerationInput } from "@/lib/server/generation";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { clampInt, safeString } from "@/lib/server/util";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { db, env, actor } = await requireUser(request);
    await guardMutation(request, db, "generation-create", 12, 60_000);
    const body = await readJson<Record<string, unknown>>(request);
    if (body.confirmedCredits === undefined || body.confirmedCredits === null) {
      throw new ApiError(
        409,
        "Review and confirm the estimated credit cost before generating.",
        "PRICE_CONFIRMATION_REQUIRED",
      );
    }
    const input: GenerationInput = {
      projectId: safeString(body.projectId, 80),
      modelId: safeString(body.modelId, 80),
      capability: safeString(body.capability, 40),
      prompt: safeString(body.prompt, 2000),
      durationSeconds: clampInt(body.durationSeconds ?? body.duration, 1, 60, 5),
      aspect: safeString(body.aspect, 10) || "16:9",
      resolution: safeString(body.resolution, 30),
      imageCount: clampInt(body.imageCount, 1, 4, 1),
      sourceAssetId: body.sourceAssetId ? safeString(body.sourceAssetId, 80) : null,
      idempotencyKey: body.idempotencyKey ? safeString(body.idempotencyKey, 120) : null,
      confirmedCredits: Number(body.confirmedCredits),
    };
    const created = await createGeneration(db, env, actor.user.id, input);
    return json({ generation: created.generation, reused: created.reused }, created.reused ? 200 : 202);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const { db, actor } = await requireUser(request);
    const url = new URL(request.url);
    const rows = await listGenerations(db, {
      userId: actor.user.id,
      projectId: url.searchParams.get("projectId") || undefined,
      capability: url.searchParams.get("capability") || undefined,
      status: url.searchParams.get("status") || undefined,
      limit: clampInt(url.searchParams.get("limit"), 1, 100, 30),
      offset: clampInt(url.searchParams.get("offset"), 0, 100000, 0),
    });
    const generations = await Promise.all(rows.map((row) => generationView(db, row)));
    return json({ generations });
  } catch (error) {
    return errorResponse(error);
  }
}
