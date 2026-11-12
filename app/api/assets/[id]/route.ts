import { auditRequest, guardMutation, requireUser } from "@/lib/server/context";
import { ApiError, errorResponse, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

interface AssetRow {
  id: string;
  project_id: string;
  owner_id: string;
  object_key: string;
  file_name: string;
  content_type: string;
  byte_size: number;
  kind: string;
}

export async function GET(request: Request, { params }: Context) {
  try {
    const { db, env, actor } = await requireUser(request);
    if (!env.BUCKET) throw new ApiError(503, "Media storage is not configured.", "STORAGE_MISSING");
    const { id } = await params;
    const asset = await db.first<AssetRow>(`SELECT * FROM assets WHERE id = ? LIMIT 1`, [id]);
    if (!asset || asset.owner_id !== actor.user.id) {
      throw new ApiError(404, "Media not found.", "ASSET_NOT_FOUND");
    }
    const download = new URL(request.url).searchParams.get("download") === "1";
    const disposition = `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(asset.file_name)}`;
    const range = request.headers.get("range");
    const headers = new Headers({
      "content-type": asset.content_type,
      "content-disposition": disposition,
      "accept-ranges": "bytes",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    });

    if (range && /^bytes=\d*-\d*$/.test(range)) {
      const [startText, endText] = range.slice(6).split("-");
      const start = startText ? Number(startText) : Math.max(0, asset.byte_size - Number(endText));
      const end = endText && startText ? Math.min(Number(endText), asset.byte_size - 1) : asset.byte_size - 1;
      if (start >= asset.byte_size || end < start) {
        return new Response(null, {
          status: 416,
          headers: { "content-range": `bytes */${asset.byte_size}` },
        });
      }
      const length = end - start + 1;
      const object = await env.BUCKET.get(asset.object_key, { range: { offset: start, length } });
      if (!object) throw new ApiError(404, "The media file is missing from storage.", "ASSET_MISSING");
      headers.set("content-range", `bytes ${start}-${end}/${asset.byte_size}`);
      headers.set("content-length", String(length));
      return new Response(object.body, { status: 206, headers });
    }

    const object = await env.BUCKET.get(asset.object_key);
    if (!object) throw new ApiError(404, "The media file is missing from storage.", "ASSET_MISSING");
    headers.set("content-length", String(asset.byte_size));
    return new Response(object.body, { status: 200, headers });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const { db, env, actor } = await requireUser(request);
    await guardMutation(request, db, "asset-delete", 30, 60_000);
    const { id } = await params;
    const asset = await db.first<AssetRow>(`SELECT * FROM assets WHERE id = ? AND owner_id = ? LIMIT 1`, [
      id,
      actor.user.id,
    ]);
    if (!asset) throw new ApiError(404, "Media not found.", "ASSET_NOT_FOUND");
    if (env.BUCKET) await env.BUCKET.delete(asset.object_key).catch(() => undefined);
    await db.batch([
      { sql: `DELETE FROM assets WHERE id = ? AND owner_id = ?`, params: [id, actor.user.id] },
      {
        sql: `UPDATE projects SET selected_asset_id = NULL WHERE id = ? AND selected_asset_id = ?`,
        params: [asset.project_id, id],
      },
      {
        sql: `UPDATE generations SET output_asset_id = NULL WHERE output_asset_id = ? AND owner_id = ?`,
        params: [id, actor.user.id],
      },
    ]);
    await auditRequest(db, request, actor, "asset.deleted", "asset", id, { projectId: asset.project_id });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
