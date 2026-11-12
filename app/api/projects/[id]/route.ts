import { auditRequest, guardMutation, requireUser } from "@/lib/server/context";
import type { Db } from "@/lib/server/db";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { now, parseJson } from "@/lib/server/util";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  prompt: string;
  aspect: string;
  duration: number;
  trim_start: number;
  trim_end: number;
  overlay_title: string;
  selected_asset_id: string | null;
  caption_enabled: number;
  captions: string;
  created_at: number;
  updated_at: number;
}

function ownedProject(db: Db, projectId: string, ownerId: string) {
  return db.first<ProjectRow>(`SELECT * FROM projects WHERE id = ? AND owner_id = ? LIMIT 1`, [
    projectId,
    ownerId,
  ]);
}

function toApiProject(row: ProjectRow) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    prompt: row.prompt,
    aspect: row.aspect,
    duration: row.duration,
    trimStart: row.trim_start,
    trimEnd: row.trim_end,
    overlayTitle: row.overlay_title,
    selectedAssetId: row.selected_asset_id,
    captionEnabled: row.caption_enabled,
    captions: parseJson(row.captions, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: Request, { params }: Context) {
  try {
    const { db, actor } = await requireUser(request);
    const { id } = await params;
    const project = await ownedProject(db, id, actor.user.id);
    if (!project) throw new ApiError(404, "Project not found.", "PROJECT_NOT_FOUND");
    return json({ project: toApiProject(project) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { db, actor } = await requireUser(request);
    await guardMutation(request, db, "project-update", 120, 60_000);
    const { id } = await params;
    const project = await ownedProject(db, id, actor.user.id);
    if (!project) throw new ApiError(404, "Project not found.", "PROJECT_NOT_FOUND");
    const body = await readJson<Record<string, unknown>>(request);
    const patch: Record<string, unknown> = { updated_at: now() };
    if (typeof body.name === "string") patch.name = body.name.slice(0, 100) || "Untitled video";
    if (typeof body.prompt === "string") patch.prompt = body.prompt.slice(0, 1800);
    if (typeof body.aspect === "string" && ["16:9", "9:16", "1:1"].includes(body.aspect)) patch.aspect = body.aspect;
    if (typeof body.duration === "number" && [5, 8, 10].includes(body.duration)) patch.duration = body.duration;
    if (Number.isFinite(body.trimStart)) patch.trim_start = Math.max(0, Number(body.trimStart));
    if (Number.isFinite(body.trimEnd)) patch.trim_end = Math.max(0, Number(body.trimEnd));
    if (typeof body.overlayTitle === "string") patch.overlay_title = body.overlayTitle.slice(0, 120);
    if (body.selectedAssetId === null) {
      patch.selected_asset_id = null;
    } else if (typeof body.selectedAssetId === "string") {
      const asset = await db.first<{ id: string }>(
        `SELECT id FROM assets WHERE id = ? AND project_id = ? AND owner_id = ? LIMIT 1`,
        [body.selectedAssetId, id, actor.user.id],
      );
      if (!asset) throw new ApiError(400, "That media file is not part of this project.", "INVALID_ASSET");
      patch.selected_asset_id = body.selectedAssetId;
    }
    if (typeof body.captionEnabled === "boolean" || body.captionEnabled === 0 || body.captionEnabled === 1) {
      patch.caption_enabled = body.captionEnabled ? 1 : 0;
    }
    if (Array.isArray(body.captions)) patch.captions = JSON.stringify(body.captions.slice(0, 500));

    const columns = Object.keys(patch);
    const values = [...Object.values(patch), id, actor.user.id];
    await db.run(
      `UPDATE projects SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ? AND owner_id = ?`,
      values as Array<string | number | null>,
    );
    const updated = await ownedProject(db, id, actor.user.id);
    return json({ project: updated ? toApiProject(updated) : null });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const { db, env, actor } = await requireUser(request);
    await guardMutation(request, db, "project-delete", 10, 60_000);
    const { id } = await params;
    const project = await ownedProject(db, id, actor.user.id);
    if (!project) throw new ApiError(404, "Project not found.", "PROJECT_NOT_FOUND");
    const assets = await db.all<{ id: string; object_key: string }>(
      `SELECT id, object_key FROM assets WHERE project_id = ? AND owner_id = ?`,
      [id, actor.user.id],
    );
    if (env.BUCKET) {
      for (const asset of assets) {
        await env.BUCKET.delete(asset.object_key).catch(() => undefined);
      }
    }
    await db.batch([
      { sql: `DELETE FROM assets WHERE project_id = ? AND owner_id = ?`, params: [id, actor.user.id] },
      {
        sql: `UPDATE generations SET output_asset_id = NULL WHERE project_id = ? AND owner_id = ?`,
        params: [id, actor.user.id],
      },
      { sql: `DELETE FROM projects WHERE id = ? AND owner_id = ?`, params: [id, actor.user.id] },
    ]);
    await auditRequest(db, request, actor, "project.deleted", "project", id, { assets: assets.length });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
