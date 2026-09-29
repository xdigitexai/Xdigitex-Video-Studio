import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { projects } from "@/db/schema";
import { authError, currentOwner, json } from "../_lib";

export const dynamic = "force-dynamic";

export async function GET() {
  const ownerId = await currentOwner();
  if (!ownerId) return authError();
  const rows = await getDb().select().from(projects).where(eq(projects.ownerId, ownerId)).orderBy(desc(projects.updatedAt));
  return json({ projects: rows.map(({ captions, ...p }) => ({ ...p, captions: JSON.parse(captions) })) });
}

export async function POST(request: Request) {
  const ownerId = await currentOwner();
  if (!ownerId) return authError();
  const body = await request.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
  const now = Date.now();
  const project = {
    id: crypto.randomUUID(), ownerId, name: String(body.name || "Untitled video").slice(0, 100),
    prompt: "", aspect: "16:9", duration: 5, trimStart: 0, trimEnd: 0, overlayTitle: "", selectedAssetId: null, captionEnabled: 1,
    captions: "[]", createdAt: now, updatedAt: now,
  };
  await getDb().insert(projects).values(project);
  return json({ project: { ...project, captions: [] } }, 201);
}
