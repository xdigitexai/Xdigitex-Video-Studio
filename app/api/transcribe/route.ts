import { guardMutation, requireUser } from "@/lib/server/context";
import { getEntitlements } from "@/lib/server/plans";
import { listCustomerModels } from "@/lib/server/models";
import { resolveProviderRuntime } from "@/lib/server/providers/service";
import { runDirectUsage } from "@/lib/server/generation";
import { ApiError, errorResponse, json } from "@/lib/server/http";
import { now, parseJson } from "@/lib/server/util";
import type { SourceMedia } from "@/lib/server/providers/types";

export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const { db, env, actor } = await requireUser(request);
    await guardMutation(request, db, "transcribe", 10, 60_000);
    const form = await request.formData().catch(() => null);
    if (!form) throw new ApiError(400, "Expected a multipart form upload.", "INVALID_FORM");
    const projectId = String(form.get("projectId") || "");
    const project = await db.first<{ id: string; captions: string }>(
      `SELECT id, captions FROM projects WHERE id = ? AND owner_id = ? LIMIT 1`,
      [projectId, actor.user.id],
    );
    if (!project) throw new ApiError(404, "Project not found.", "PROJECT_NOT_FOUND");
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new ApiError(400, "No audio was received.", "AUDIO_REQUIRED");
    if (file.size > MAX_AUDIO_BYTES) {
      throw new ApiError(413, "Audio must be 25 MB or smaller. Shorten the clip and try again.", "FILE_TOO_LARGE");
    }
    const offset = Math.max(0, Math.min(86_400, Number(form.get("offset") || 0)));
    const durationSeconds = Math.max(
      1,
      Math.min(3600, Number(form.get("duration") || 60) || 60),
    );

    const entitlements = await getEntitlements(db, actor.user.id);
    if (!entitlements.plan) {
      throw new ApiError(402, "Automatic captions need an active subscription.", "SUBSCRIPTION_REQUIRED");
    }
    const models = await listCustomerModels(db, {
      capability: "transcription",
      planModelIds: entitlements.modelIds,
    });
    const model = models.find((candidate) => candidate.planAllowed);
    if (!model) {
      throw new ApiError(403, "Your plan does not include a transcription model.", "MODEL_NOT_IN_PLAN");
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const source: SourceMedia = {
      fileName: file.name || "studio-audio.webm",
      contentType: file.type || "audio/webm",
      byteSize: file.size,
      async bytes() {
        return bytes;
      },
      async stream() {
        return new Blob([bytes]).stream();
      },
    };

    const runtime = await resolveProviderRuntime(db, model.providerId, env);
    if (!runtime.adapter.transcribe) {
      throw new ApiError(503, "This transcription model is not available.", "TRANSCRIBE_UNSUPPORTED");
    }

    const usage = await runDirectUsage(
      db,
      env,
      {
        userId: actor.user.id,
        projectId,
        modelId: model.id,
        capability: "transcription",
        prompt: `Transcribe ${file.name || "audio"}`,
        durationSeconds,
        description: "Audio transcription",
      },
      () =>
        runtime.adapter.transcribe!(runtime.context, {
          modelCode: model.code,
          source,
        }),
    );

    const captions = usage.result.segments.map((segment) => ({
      start: offset + Math.max(0, segment.start),
      end: offset + Math.max(segment.start + 0.2, segment.end),
      text: segment.text,
    }));
    await db.run(`UPDATE projects SET captions = ?, updated_at = ? WHERE id = ? AND owner_id = ?`, [
      JSON.stringify(captions),
      now(),
      projectId,
      actor.user.id,
    ]);
    return json({
      captions,
      creditsCharged: usage.credits,
      language: usage.result.language ?? null,
      previousCaptions: parseJson(project.captions, []).length,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
