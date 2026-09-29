import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { projects } from "@/db/schema";

export async function currentOwner() {
  const h = await headers();
  return h.get("oai-authenticated-user-id");
}

export const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });

export async function ownedProject(projectId: string, ownerId: string) {
  const [project] = await getDb().select().from(projects).where(
    and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)),
  ).limit(1);
  return project ?? null;
}

export function authError() {
  return json({ error: "Sign in with ChatGPT to use your private studio." }, 401);
}

export function safeFileName(value: string) {
  return value.replace(/[\\/\r\n\0]/g, "_").slice(0, 160) || "video";
}
