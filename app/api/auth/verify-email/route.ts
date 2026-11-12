import { verifyEmailToken } from "@/lib/server/accounts";
import { createSession } from "@/lib/server/auth";
import { auditRequest, contextFromRequest, guardMutation } from "@/lib/server/context";
import { ApiError, clientIp, errorResponse, json, readJson, userAgent } from "@/lib/server/http";
import { publicUser, sessionCookieHeader } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { db } = await contextFromRequest(request);
    await guardMutation(request, db, "verify-email", 20, 10 * 60_000);
    const body = await readJson<{ token?: string }>(request);
    const user = await verifyEmailToken(db, String(body.token ?? ""));
    if (!user) {
      throw new ApiError(400, "This verification link is invalid or has expired.", "INVALID_TOKEN");
    }
    const session = await createSession(db, user.id, {
      ip: clientIp(request),
      userAgent: userAgent(request),
    });
    await auditRequest(db, request, { user, via: "session" }, "auth.email_verified", "user", user.id);
    return json(
      { ok: true, user: publicUser(user) },
      200,
      { "set-cookie": sessionCookieHeader(request, session.token, session.expiresAt) },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
