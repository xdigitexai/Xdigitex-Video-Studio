import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { projects } from "@/db/schema";
import { auditRequest, guardMutation, requireUser } from "@/lib/server/context";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { newId, now, parseJson, safeString } from "@/lib/server/util";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { actor } = await requireUser(request);
    const rows = await getDb()
      .select()
      .from(projects)
      .where(eq(projects.ownerId, actor.user.id))
      .orderBy(desc(projects.updatedAt));
    return json({
      projects: rows.map(({ captions, ...project }) => ({ ...project, captions: parseJson(captions, []) })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, actor } = await requireUser(request);
    await guardMutation(request, db, "project-create", 20, 60_000);
    const body = await readJson<{ name?: string }>(request);
    const count = await db.first<{ count: number }>(`SELECT COUNT(*) AS count FROM projects WHERE owner_id = ?`, [
      actor.user.id,
    ]);
    if ((count?.count ?? 0) >= 200) {
      throw new ApiError(403, "You have reached the 200-project limit. Delete an old project first.", "PROJECT_LIMIT");
    }
    const timestamp = now();
    const project = {
      id: newId("prj"),
      ownerId: actor.user.id,
      name: safeString(body.name, 100) || "Untitled video",
      prompt: "",
      aspect: "16:9",
      duration: 5,
      trimStart: 0,
      trimEnd: 0,
      overlayTitle: "",
      selectedAssetId: null,
      captionEnabled: 1,
      captions: "[]",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await getDb().insert(projects).values(project);
    await auditRequest(db, request, actor, "project.created", "project", project.id);
    return json({ project: { ...project, captions: [] } }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
