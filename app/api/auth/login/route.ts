import { authenticateAccount } from "@/lib/server/accounts";
import { createSession } from "@/lib/server/auth";
import { auditRequest, contextFromRequest, guardMutation } from "@/lib/server/context";
import { clientIp, errorResponse, json, readJson, userAgent } from "@/lib/server/http";
import { publicUser, sessionCookieHeader } from "@/lib/server/session";
import { isEmailVerificationRequired } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { db } = await contextFromRequest(request);
    await guardMutation(request, db, "login", 10, 10 * 60_000);
    const body = await readJson<{ email?: string; password?: string }>(request);
    const { user } = await authenticateAccount(db, String(body.email ?? ""), String(body.password ?? ""), {
      emailVerificationRequired: await isEmailVerificationRequired(db),
    });
    const session = await createSession(db, user.id, {
      ip: clientIp(request),
      userAgent: userAgent(request),
    });
    await auditRequest(db, request, { user, via: "session" }, "auth.login", "user", user.id);
    return json(
      { ok: true, user: publicUser(user) },
      200,
      { "set-cookie": sessionCookieHeader(request, session.token, session.expiresAt) },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
