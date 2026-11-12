import { auditRequest, guardMutation, requireUser } from "@/lib/server/context";
import { cancelGeneration } from "@/lib/server/generation";
import { errorResponse, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { db, env, actor } = await requireUser(request);
    await guardMutation(request, db, "generation-cancel", 20, 60_000);
    const { id } = await params;
    const generation = await cancelGeneration(db, env, id, actor.user.id);
    await auditRequest(db, request, actor, "generation.cancelled", "generation", id);
    return json({ generation });
  } catch (error) {
    return errorResponse(error);
  }
}
