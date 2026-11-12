import { auditRequest, guardMutation, requireUser } from "@/lib/server/context";
import { getEntitlements } from "@/lib/server/plans";
import { ApiError, errorResponse, json } from "@/lib/server/http";
import { newId, now } from "@/lib/server/util";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

const MAX_VIDEO_BYTES = 95_000_000;
const MAX_IMAGE_BYTES = 25_000_000;
const FREE_STORAGE_BYTES = 100 * 1024 * 1024;

function safeFileName(value: string) {
  return value.replace(/[\\/\r\n\0]/g, "_").slice(0, 160) || "media";
}

async function ownedProject(projectId: string, ownerId: string, db: Awaited<ReturnType<typeof requireUser>>["db"]) {
  return db.first<{ id: string }>(`SELECT id FROM projects WHERE id = ? AND owner_id = ? LIMIT 1`, [
    projectId,
    ownerId,
  ]);
}

export async function GET(request: Request, { params }: Context) {
  try {
    const { db, actor } = await requireUser(request);
    const { id } = await params;
    if (!(await ownedProject(id, actor.user.id, db))) {
      throw new ApiError(404, "Project not found.", "PROJECT_NOT_FOUND");
    }
    const rows = await db.all<{
      id: string;
      project_id: string;
      file_name: string;
      content_type: string;
      byte_size: number;
      kind: string;
      created_at: number;
    }>(
      `SELECT id, project_id, file_name, content_type, byte_size, kind, created_at
       FROM assets WHERE project_id = ? AND owner_id = ? ORDER BY created_at DESC`,
      [id, actor.user.id],
    );
    return json({
      assets: rows.map((asset) => ({
        id: asset.id,
        projectId: asset.project_id,
        fileName: asset.file_name,
        contentType: asset.content_type,
        byteSize: asset.byte_size,
        kind: asset.kind,
        createdAt: asset.created_at,
        url: `/api/assets/${asset.id}`,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const { db, env, actor } = await requireUser(request);
    await guardMutation(request, db, "asset-upload", 30, 60_000);
    const { id: projectId } = await params;
    if (!(await ownedProject(projectId, actor.user.id, db))) {
      throw new ApiError(404, "Project not found.", "PROJECT_NOT_FOUND");
    }
    if (!env.BUCKET || !request.body) {
      throw new ApiError(503, "Media storage is not configured.", "STORAGE_MISSING");
    }
    const size = Number(request.headers.get("x-file-size") || request.headers.get("content-length") || 0);
    if (!Number.isFinite(size) || size < 1) {
      throw new ApiError(400, "Could not read the file size. Choose the file again and retry.", "INVALID_SIZE");
    }
    const contentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const isVideo = contentType.startsWith("video/");
    const isImage = contentType.startsWith("image/");
    if (!isVideo && !isImage) {
      throw new ApiError(415, "Choose a video or image file.", "UNSUPPORTED_MEDIA");
    }
    if (isVideo && size > MAX_VIDEO_BYTES) {
      throw new ApiError(413, "Video is over the 95 MB upload limit.", "FILE_TOO_LARGE");
    }
    if (isImage && size > MAX_IMAGE_BYTES) {
      throw new ApiError(413, "Image is over the 25 MB upload limit.", "FILE_TOO_LARGE");
    }

    const entitlements = await getEntitlements(db, actor.user.id);
    const quota = entitlements.plan ? entitlements.limits.storageLimitBytes : FREE_STORAGE_BYTES;
    if (entitlements.usage.storageBytes + size > quota) {
      throw new ApiError(
        413,
        `This upload exceeds your ${Math.round(quota / (1024 * 1024))} MB storage limit. Delete media or upgrade your plan.`,
        "STORAGE_LIMIT",
      );
    }

    const rawName = request.headers.get("x-file-name");
    let fileName = "upload";
    try {
      fileName = rawName ? decodeURIComponent(rawName) : "upload";
    } catch {
      fileName = "upload";
    }
    fileName = safeFileName(fileName);
    const assetId = newId("ast");
    const extension = fileName.includes(".") ? fileName.split(".").pop()!.slice(0, 8) : isVideo ? "mp4" : "png";
    const key = `users/${encodeURIComponent(actor.user.id)}/projects/${projectId}/${assetId}.${extension}`;
    try {
      await env.BUCKET.put(key, request.body, {
        httpMetadata: {
          contentType,
          contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        },
      });
      const stored = await env.BUCKET.head(key);
      if (!stored || stored.size !== size) throw new Error("Stored file size did not match the upload.");
      const timestamp = now();
      await db.run(
        `INSERT INTO assets (id, project_id, owner_id, object_key, file_name, content_type, byte_size, kind, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'source', ?)`,
        [assetId, projectId, actor.user.id, key, fileName, contentType, stored.size, timestamp],
      );
      await auditRequest(db, request, actor, "asset.uploaded", "asset", assetId, { projectId, size, contentType });
      return json(
        {
          asset: {
            id: assetId,
            projectId,
            fileName,
            contentType,
            byteSize: stored.size,
            kind: "source",
            url: `/api/assets/${assetId}`,
          },
        },
        201,
      );
    } catch (error) {
      await env.BUCKET.delete(key).catch(() => undefined);
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, "Upload failed. Your project is safe; try the upload again.", "UPLOAD_FAILED");
    }
  } catch (error) {
    return errorResponse(error);
  }
}
