import { guardMutation, requireUser } from "@/lib/server/context";
import { refreshGeneration } from "@/lib/server/generation";
import { errorResponse, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { db, env, actor } = await requireUser(request);
    const { id } = await params;
    const generation = await refreshGeneration(db, env, id, actor.user.id);
    return json({ generation });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const { db, env, actor } = await requireUser(request);
    await guardMutation(request, db, "generation-refresh", 120, 60_000);
    const { id } = await params;
    const generation = await refreshGeneration(db, env, id, actor.user.id);
    return json({ generation });
  } catch (error) {
    return errorResponse(error);
  }
}
