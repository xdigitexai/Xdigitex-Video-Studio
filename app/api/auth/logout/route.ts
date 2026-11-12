import { destroySession, SESSION_COOKIE } from "@/lib/server/auth";
import { contextFromRequest, guardMutation } from "@/lib/server/context";
import { errorResponse, json, parseCookies } from "@/lib/server/http";
import { clearSessionCookieHeader } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { db } = await contextFromRequest(request);
    await guardMutation(request, db, "logout", 30, 60_000);
    const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
    if (token) await destroySession(db, token);
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookieHeader(request) });
  } catch (error) {
    return errorResponse(error);
  }
}
