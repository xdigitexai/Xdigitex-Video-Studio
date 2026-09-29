import { env } from "cloudflare:workers";
import { desc, eq, and } from "drizzle-orm";
import { getDb } from "@/db";
import { assets } from "@/db/schema";
import { authError, currentOwner, json, ownedProject, safeFileName } from "../../../_lib";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const ownerId = await currentOwner();
  if (!ownerId) return authError();
  const { id } = await params;
  if (!await ownedProject(id, ownerId)) return json({ error: "Project not found." }, 404);
  const rows = await getDb().select().from(assets).where(and(eq(assets.projectId, id), eq(assets.ownerId, ownerId))).orderBy(desc(assets.createdAt));
  return json({ assets: rows.map((asset) => ({ ...asset, url: `/api/assets/${asset.id}` })) });
}

export async function POST(request: Request, { params }: Context) {
  const ownerId = await currentOwner();
  if (!ownerId) return authError();
  const { id: projectId } = await params;
  if (!await ownedProject(projectId, ownerId)) return json({ error: "Project not found." }, 404);
  if (!env.BUCKET || !request.body) return json({ error: "Video storage is not configured." }, 503);
  const size = Number(request.headers.get("x-file-size") || request.headers.get("content-length") || 0);
  if (!Number.isFinite(size) || size < 1) return json({ error: "Could not read the video file size. Choose the file again and retry." }, 400);
  if (size > 95_000_000) return json({ error: "Video is over the 95 MB upload limit for this Studio." }, 413);
  const contentType = (request.headers.get("content-type") || "video/mp4").split(";")[0];
  if (!contentType.startsWith("video/")) return json({ error: "Choose a video file." }, 415);
  const fileName = safeFileName(decodeURIComponent(request.headers.get("x-file-name") || "video.mp4"));
  const assetId = globalThis.crypto.randomUUID();
  const key = `users/${encodeURIComponent(ownerId)}/projects/${projectId}/${assetId}`;
  try {
    await env.BUCKET.put(key, request.body, { httpMetadata: { contentType, contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(fileName)}` } });
    const stored = await env.BUCKET.head(key);
    if (!stored || stored.size !== size) throw new Error("Stored file size did not match the upload.");
    const row = { id: assetId, projectId, ownerId, objectKey: key, fileName, contentType, byteSize: stored.size, kind: "source", createdAt: Date.now() };
    await getDb().insert(assets).values(row);
    return json({ asset: { ...row, url: `/api/assets/${assetId}` } }, 201);
  } catch {
    await env.BUCKET.delete(key).catch(() => undefined);
    return json({ error: "Upload failed. Your project is safe; try the upload again." }, 503);
  }
}
