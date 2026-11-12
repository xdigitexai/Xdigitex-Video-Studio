import { guardMutation, requireUser } from "@/lib/server/context";
import { getEntitlements } from "@/lib/server/plans";
import { listCustomerModels } from "@/lib/server/models";
import { resolveProviderRuntime } from "@/lib/server/providers/service";
import { runDirectUsage } from "@/lib/server/generation";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { safeString } from "@/lib/server/util";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { db, env, actor } = await requireUser(request);
    await guardMutation(request, db, "prompt-enhance", 20, 60_000);
    const body = await readJson<{ projectId?: string; prompt?: string; modelId?: string; instructions?: string }>(
      request,
    );
    const projectId = safeString(body.projectId, 80);
    const prompt = safeString(body.prompt, 1800);
    if (!projectId) throw new ApiError(400, "Choose a project.", "PROJECT_REQUIRED");
    if (!prompt) throw new ApiError(400, "Write an idea to improve first.", "PROMPT_REQUIRED");
    const project = await db.first<{ id: string }>(
      `SELECT id FROM projects WHERE id = ? AND owner_id = ? LIMIT 1`,
      [projectId, actor.user.id],
    );
    if (!project) throw new ApiError(404, "Project not found.", "PROJECT_NOT_FOUND");

    const entitlements = await getEntitlements(db, actor.user.id);
    if (!entitlements.plan) {
      throw new ApiError(402, "Prompt enhancement needs an active subscription.", "SUBSCRIPTION_REQUIRED");
    }
    const models = await listCustomerModels(db, {
      capability: "prompt_enhance",
      planModelIds: entitlements.modelIds,
    });
    const requested = body.modelId
      ? models.find((model) => model.id === body.modelId && model.planAllowed)
      : null;
    const model = requested ?? models.find((candidate) => candidate.planAllowed);
    if (!model) {
      throw new ApiError(403, "Your plan does not include a prompt model.", "MODEL_NOT_IN_PLAN");
    }
    const runtime = await resolveProviderRuntime(db, model.providerId, env);
    if (!runtime.adapter.enhancePrompt) {
      throw new ApiError(503, "This prompt model is not available.", "PROMPT_UNSUPPORTED");
    }
    const usage = await runDirectUsage(
      db,
      env,
      {
        userId: actor.user.id,
        projectId,
        modelId: model.id,
        capability: "prompt_enhance",
        prompt,
        durationSeconds: 1,
        description: "Prompt enhancement",
      },
      () =>
        runtime.adapter.enhancePrompt!(runtime.context, {
          modelCode: model.code,
          prompt,
          instructions: safeString(body.instructions, 500) || undefined,
        }),
    );
    return json({ prompt: usage.result.text, creditsCharged: usage.credits, model: model.displayName });
  } catch (error) {
    return errorResponse(error);
  }
}
