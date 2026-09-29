import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { assets } from "@/db/schema";
import { authError, currentOwner, json } from "../../_lib";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const ownerId = await currentOwner();
  if (!ownerId) return authError();
  if (!env.BUCKET) return json({ error: "Video storage is not configured." }, 503);
  const { id } = await params;
  const [asset] = await getDb().select().from(assets).where(eq(assets.id, id)).limit(1);
  if (!asset || asset.ownerId !== ownerId) return json({ error: "Video not found." }, 404);
  const range = request.headers.get("range");
  let object;
  let status = 200;
  const headers = new Headers({
    "content-type": asset.contentType,
    "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  });
  if (range && /^bytes=\d*-\d*$/.test(range)) {
    const [startText, endText] = range.slice(6).split("-");
    const start = startText ? Number(startText) : Math.max(0, asset.byteSize - Number(endText));
    const end = endText && startText ? Math.min(Number(endText), asset.byteSize - 1) : asset.byteSize - 1;
    if (start >= asset.byteSize || end < start) return new Response(null, { status: 416, headers: { "content-range": `bytes */${asset.byteSize}` } });
    const length = end - start + 1;
    object = await env.BUCKET.get(asset.objectKey, { range: { offset: start, length } });
    headers.set("content-range", `bytes ${start}-${end}/${asset.byteSize}`);
    headers.set("content-length", String(length));
    status = 206;
  } else {
    object = await env.BUCKET.get(asset.objectKey);
    headers.set("content-length", String(asset.byteSize));
  }
  if (!object) return json({ error: "Video file is missing from storage." }, 404);
  return new Response(object.body, { status, headers });
}
