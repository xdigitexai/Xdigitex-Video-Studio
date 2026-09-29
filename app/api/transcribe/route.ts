import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { projects } from "@/db/schema";
import { authError, currentOwner, json, ownedProject } from "../_lib";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ownerId = await currentOwner();
  if (!ownerId) return authError();
  if (!env.OPENAI_API_KEY) return json({ error: "Automatic captions are not connected yet. Add OPENAI_API_KEY to the Studio's server secrets to enable them." }, 503);
  const form = await request.formData().catch(() => null);
  const projectId = String(form?.get("projectId") || "");
  const project = await ownedProject(projectId, ownerId);
  if (!project) return json({ error: "Project not found." }, 404);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size) return json({ error: "No audio was received." }, 400);
  if (file.size > 25 * 1024 * 1024) return json({ error: "Audio must be 25 MB or smaller. Shorten the clip and try again." }, 413);
  const requestBody = new FormData();
  requestBody.append("file", file, "studio-audio.webm");
  requestBody.append("model", "whisper-1");
  requestBody.append("response_format", "verbose_json");
  requestBody.append("timestamp_granularities[]", "segment");
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: requestBody,
  });
  if (!response.ok) {
    const detail = await response.text();
    return json({ error: `Caption generation failed (${response.status}). ${detail.slice(0, 240)}` }, 502);
  }
  const result = await response.json() as { segments?: Array<{ start: number; end: number; text: string }> };
  const offset = Math.max(0, Math.min(86400, Number(form?.get("offset") || 0)));
  const captions = (result.segments || []).map((segment) => ({ start: offset + Math.max(0, segment.start), end: offset + Math.max(segment.start + 0.2, segment.end), text: segment.text.trim() })).filter((segment) => segment.text);
  await getDb().update(projects).set({ captions: JSON.stringify(captions), updatedAt: Date.now() }).where(eq(projects.id, projectId));
  return json({ captions });
}
