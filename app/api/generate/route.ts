import { env } from "cloudflare:workers";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { assets, generations } from "@/db/schema";
import { authError, currentOwner, json, ownedProject } from "../_lib";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ownerId = await currentOwner();
  if (!ownerId) return authError();
  if (!env.RUNWAY_API_KEY) return json({ error: "AI generation is not connected yet. Add RUNWAY_API_KEY to the Studio's server secrets to enable it." }, 503);
  const body = await request.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
  const projectId = String(body.projectId || "");
  const project = await ownedProject(projectId, ownerId);
  if (!project) return json({ error: "Project not found." }, 404);
  const prompt = String(body.prompt || "").trim();
  const duration = Number(body.duration);
  const aspect = String(body.aspect);
  const mode = body.mode === "edit" ? "edit" : "generate";
  if (prompt.length < 12 || prompt.length > 1000) return json({ error: "Write a specific prompt from 12 to 1,000 characters." }, 400);
  if ((mode === "generate" && ![5, 10].includes(duration)) || (mode === "edit" && (!Number.isInteger(duration) || duration < 2 || duration > 30)) || !["16:9", "9:16", "1:1"].includes(aspect)) return json({ error: "Choose a supported duration and aspect ratio. AI edit accepts a 2–30 second source." }, 400);
  const estimateUsd = mode === "edit" ? Math.max(duration * 0.28, 0.56) : duration * 0.12;
  if (body.confirmedEstimate !== estimateUsd) return json({ error: "Review and confirm the displayed generation estimate before starting." }, 409);
  let runway: Response;
  if (mode === "edit") {
    const assetId = String(body.assetId || "");
    const [source] = await getDb().select().from(assets).where(and(eq(assets.id, assetId), eq(assets.projectId, projectId), eq(assets.ownerId, ownerId))).limit(1);
    if (!source) return json({ error: "Choose a saved source video before using AI edit." }, 400);
    if (source.byteSize > 95_000_000) return json({ error: "AI edit accepts Studio source videos up to 95 MB." }, 413);
    if (!env.BUCKET) return json({ error: "Video storage is not configured." }, 503);
    const object = await env.BUCKET.get(source.objectKey);
    if (!object?.body) return json({ error: "The source video could not be read from storage." }, 404);
    const versionHeaders = { authorization: `Bearer ${env.RUNWAY_API_KEY}`, "X-Runway-Version": "2024-11-06" };
    const upload = await fetch("https://api.dev.runwayml.com/v1/uploads", { method:"POST", headers:{...versionHeaders,"content-type":"application/json"}, body:JSON.stringify({filename:source.fileName,type:"ephemeral"}) });
    if (!upload.ok) return json({ error: `The video provider could not prepare this source (${upload.status}).` }, 502);
    const signed = await upload.json() as { uploadUrl?:string; fields?:Record<string,string>; runwayUri?:string };
    if (!signed.uploadUrl || !signed.runwayUri || !signed.fields) return json({ error: "The video provider returned an incomplete upload request." }, 502);
    const boundary = `studio-${crypto.randomUUID()}`;
    const fieldPrefix = Object.entries(signed.fields).map(([key,value])=>`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`).join("");
    const fileName = source.fileName.replace(/[\r\n"\\]/g,"_");
    const filePrefix = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${source.contentType}\r\n\r\n`;
    const prefix = new TextEncoder().encode(fieldPrefix+filePrefix);
    const suffix = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
    const bodyStream = new ReadableStream<Uint8Array>({ async start(controller) {
      controller.enqueue(prefix);
      const reader = object.body!.getReader();
      try { while(true){const part=await reader.read();if(part.done)break;controller.enqueue(part.value);} controller.enqueue(suffix);controller.close(); }
      catch(error){controller.error(error);}
    }});
    const uploaded = await fetch(signed.uploadUrl,{method:"POST",headers:{"content-type":`multipart/form-data; boundary=${boundary}`},body:bodyStream});
    if (!uploaded.ok) return json({ error: "The source upload to the video provider failed. Your saved copy is unchanged; try again." }, 502);
    runway = await fetch("https://api.dev.runwayml.com/v1/video_to_video", {
      method:"POST", headers:{...versionHeaders,"content-type":"application/json"},
      body:JSON.stringify({model:"aleph2",videoUri:signed.runwayUri,promptText:prompt}),
    });
  } else {
    runway = await fetch("https://api.dev.runwayml.com/v1/image_to_video", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RUNWAY_API_KEY}`, "content-type": "application/json", "X-Runway-Version": "2024-11-06" },
      body: JSON.stringify({ model: "gen4.5", promptText: prompt, ratio: aspect === "16:9" ? "1280:720" : aspect === "9:16" ? "720:1280" : "960:960", duration }),
    });
  }
  if (!runway.ok) {
    const detail = await runway.text();
    return json({ error: `The video provider rejected the job (${runway.status}). ${detail.slice(0, 240)}` }, 502);
  }
  const task = await runway.json() as { id?: string; status?: string };
  if (!task.id) return json({ error: "The video provider returned no task ID." }, 502);
  const now = Date.now();
  const row = { id: crypto.randomUUID(), projectId, ownerId, providerTaskId: task.id, status: "PENDING", mode, prompt, duration, aspect, outputAssetId: null, error: null, createdAt: now, updatedAt: now };
  await getDb().insert(generations).values(row);
  return json({ generation: { ...row, estimateUsd } }, 202);
}

export async function GET(request: Request) {
  const ownerId = await currentOwner();
  if (!ownerId) return authError();
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") || "";
  if (!await ownedProject(projectId, ownerId)) return json({ error: "Project not found." }, 404);
  const [job] = await getDb().select().from(generations).where(and(eq(generations.projectId, projectId), eq(generations.ownerId, ownerId))).orderBy(desc(generations.createdAt)).limit(1);
  if (!job) return json({ generation: null });
  if (["SUCCEEDED", "FAILED", "CANCELED"].includes(job.status)) return json({ generation: job });
  if (!env.RUNWAY_API_KEY) return json({ error: "Generation status is unavailable because the provider secret is missing." }, 503);
  const taskResponse = await fetch(`https://api.dev.runwayml.com/v1/tasks/${encodeURIComponent(job.providerTaskId)}`, {
    headers: { authorization: `Bearer ${env.RUNWAY_API_KEY}`, "X-Runway-Version": "2024-11-06" },
  });
  if (!taskResponse.ok) return json({ generation: job, statusCheckError: true });
  const task = await taskResponse.json() as { status?: string; output?: string[]; failure?: string };
  let outputAssetId: string | null = null;
  let status = task.status || job.status;
  let error: string | null = task.failure || null;
  if (status === "SUCCEEDED" && task.output?.[0] && env.BUCKET) {
    const response = await fetch(task.output[0]);
    if (response.ok && response.body) {
      const outputAsset = { id: crypto.randomUUID(), projectId: job.projectId, ownerId, objectKey: `users/${encodeURIComponent(ownerId)}/projects/${projectId}/${crypto.randomUUID()}`, fileName: `generated-${new Date().toISOString().slice(0, 10)}.mp4`, contentType: "video/mp4", byteSize: Number(response.headers.get("content-length") || 0), kind: "generated", createdAt: Date.now() };
      const stored = await env.BUCKET.put(outputAsset.objectKey, response.body, { httpMetadata: { contentType: outputAsset.contentType } });
      outputAsset.byteSize = stored.size;
      await getDb().insert(assets).values(outputAsset);
      outputAssetId = outputAsset.id;
    }
  }
  if (status === "SUCCEEDED" && !outputAssetId) { status = "FAILED"; error = "The provider finished, but the video could not be saved to your Studio."; }
  const updatedAt = Date.now();
  await getDb().update(generations).set({ status, error, outputAssetId: outputAssetId || job.outputAssetId, updatedAt }).where(eq(generations.id, job.id));
  return json({ generation: { ...job, status, error, outputAssetId: outputAssetId || job.outputAssetId, updatedAt } });
}
