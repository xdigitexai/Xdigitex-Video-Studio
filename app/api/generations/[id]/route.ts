import { guardMutation, requireUser } from "@/lib/server/context";
import { emailAlreadySent } from "@/lib/server/email";
import { emailConfig, trySendRenderedEmail } from "@/lib/server/email-notifications";
import { videoCompletedEmail } from "@/lib/server/email-templates";
import { refreshGeneration, type GenerationView } from "@/lib/server/generation";
import { errorResponse, json } from "@/lib/server/http";
import type { Db } from "@/lib/server/db";
import type { RuntimeEnv } from "@/lib/server/runtime";
import type { UserRow } from "@/lib/server/auth-types";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

async function notifyIfCompleted(
  db: Db,
  env: RuntimeEnv,
  user: UserRow,
  generation: GenerationView,
): Promise<void> {
  if (generation.status !== "SUCCEEDED") return;
  if (await emailAlreadySent(db, "video_completed", generation.id)) return;
  const siteUrl = env.APP_URL;
  await trySendRenderedEmail(
    db,
    emailConfig(env),
    user.email,
    "video_completed",
    videoCompletedEmail({
      name: user.display_name,
      project: "Your project",
      prompt: generation.prompt,
      url: `${siteUrl}/studio/${generation.projectId}?generation=${generation.id}`,
      siteUrl,
    }),
  );
}

async function load(request: Request, context: Context) {
  const { db, env, actor } = await requireUser(request);
  const { id } = await context.params;
  const generation = await refreshGeneration(db, env, id, actor.user.id);
  await notifyIfCompleted(db, env, actor.user, generation);
  return json({ generation });
}

export async function GET(request: Request, context: Context) {
  try {
    return await load(request, context);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { db } = await requireUser(request);
    await guardMutation(request, db, "generation-refresh", 120, 60_000);
    return await load(request, context);
  } catch (error) {
    return errorResponse(error);
  }
}
