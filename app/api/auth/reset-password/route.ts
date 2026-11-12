import { resetPasswordWithToken } from "@/lib/server/accounts";
import { createSession } from "@/lib/server/auth";
import { auditRequest, contextFromRequest, guardMutation } from "@/lib/server/context";
import { ApiError, clientIp, errorResponse, json, readJson, userAgent } from "@/lib/server/http";
import { publicUser, sessionCookieHeader } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { db } = await contextFromRequest(request);
    await guardMutation(request, db, "reset-password", 10, 10 * 60_000);
    const body = await readJson<{ token?: string; password?: string }>(request);
    const user = await resetPasswordWithToken(db, String(body.token ?? ""), String(body.password ?? ""));
    if (!user) {
      throw new ApiError(400, "This reset link is invalid or has expired.", "INVALID_TOKEN");
    }
    const session = await createSession(db, user.id, {
      ip: clientIp(request),
      userAgent: userAgent(request),
    });
    await auditRequest(db, request, { user, via: "session" }, "auth.password_reset", "user", user.id);
    return json(
      { ok: true, user: publicUser(user) },
      200,
      { "set-cookie": sessionCookieHeader(request, session.token, session.expiresAt) },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
