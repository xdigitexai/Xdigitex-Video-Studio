import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { projects } from "@/db/schema";
import { authError, currentOwner, json, ownedProject } from "../../_lib";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const ownerId = await currentOwner();
  if (!ownerId) return authError();
  const { id } = await params;
  const project = await ownedProject(id, ownerId);
  if (!project) return json({ error: "Project not found." }, 404);
  return json({ project: { ...project, captions: JSON.parse(project.captions) } });
}

export async function PATCH(request: Request, { params }: Context) {
  const ownerId = await currentOwner();
  if (!ownerId) return authError();
  const { id } = await params;
  if (!await ownedProject(id, ownerId)) return json({ error: "Project not found." }, 404);
  const body = await request.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (typeof body.name === "string") patch.name = body.name.slice(0, 100);
  if (typeof body.prompt === "string") patch.prompt = body.prompt.slice(0, 1800);
  if (typeof body.aspect === "string" && ["16:9", "9:16", "1:1"].includes(body.aspect)) patch.aspect = body.aspect;
  if (typeof body.duration === "number" && [5, 8, 10].includes(body.duration)) patch.duration = body.duration;
  if (Number.isFinite(body.trimStart)) patch.trimStart = Math.max(0, Number(body.trimStart));
  if (Number.isFinite(body.trimEnd)) patch.trimEnd = Math.max(0, Number(body.trimEnd));
  if (typeof body.overlayTitle === "string") patch.overlayTitle = body.overlayTitle.slice(0, 120);
  if (typeof body.selectedAssetId === "string" || body.selectedAssetId === null) patch.selectedAssetId = body.selectedAssetId;
  if (typeof body.captionEnabled === "boolean" || body.captionEnabled === 0 || body.captionEnabled === 1) patch.captionEnabled = body.captionEnabled ? 1 : 0;
  if (Array.isArray(body.captions)) patch.captions = JSON.stringify(body.captions.slice(0, 500));
  await getDb().update(projects).set(patch).where(and(eq(projects.id, id), eq(projects.ownerId, ownerId)));
  const project = await ownedProject(id, ownerId);
  return json({ project: project && { ...project, captions: JSON.parse(project.captions) } });
}
