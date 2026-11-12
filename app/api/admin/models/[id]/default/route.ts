import { auditRequest, guardMutation, requireAdmin } from "@/lib/server/context";
import { getModelView, setDefaultModel } from "@/lib/server/models";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { db, actor } = await requireAdmin(request);
    await guardMutation(request, db, "admin-model-default", 20, 60_000);
    const { id } = await params;
    const model = await getModelView(db, id);
    if (!model) throw new ApiError(404, "Model not found.", "MODEL_NOT_FOUND");
    if (!model.isActive) throw new ApiError(409, "Activate this model before making it the default.", "MODEL_INACTIVE");
    const body = await readJson<{ kind?: string }>(request);
    const kind = body.kind === "image" ? "image" : "video";
    const requires = kind === "video" ? ["text_to_video", "image_to_video", "video_to_video"] : ["text_to_image"];
    if (!model.capabilities.some((capability) => requires.includes(capability))) {
      throw new ApiError(400, `This model cannot be the default ${kind} model.`, "CAPABILITY_MISMATCH");
    }
    await setDefaultModel(db, id, kind);
    await auditRequest(db, request, actor, "admin.default_model_set", "model", id, { kind });
    return json({ ok: true, kind });
  } catch (error) {
    return errorResponse(error);
  }
}
