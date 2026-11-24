import { json } from "@/lib/server/http";
import { runtimeEnv } from "@/lib/server/runtime";

export const dynamic = "force-dynamic";

export function GET() {
  const clientId = runtimeEnv().GOOGLE_OAUTH_CLIENT_ID || "";
  return json({ enabled: Boolean(clientId), clientId: clientId || null });
}
