import { dbFromRequestEnv, runtimeEnv } from "@/lib/server/runtime";
import { errorResponse, json } from "@/lib/server/http";
import { reconcilePayments } from "@/lib/server/payments/service";
import { paymentGatewayConfig } from "@/lib/server/payments/xdigitex";
import { sweepStuckGenerations } from "@/lib/server/generation";

export const dynamic = "force-dynamic";

/**
 * Scheduled maintenance endpoint for Cloudflare Cron Triggers (or an external
 * scheduler). Protected by a dedicated secret; no session is involved.
 */
async function run(request: Request) {
  const env = runtimeEnv();
  const db = dbFromRequestEnv();
  const expected = env.CRON_SECRET;
  if (!expected) {
    return json({ error: "CRON_SECRET is not configured.", code: "CRON_NOT_CONFIGURED" }, 503);
  }
  const authorization = request.headers.get("authorization") || "";
  const url = new URL(request.url);
  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : url.searchParams.get("secret") || "";
  if (provided !== expected) {
    return json({ error: "Unauthorized.", code: "UNAUTHORIZED" }, 401);
  }
  const [payments, generations] = await Promise.all([
    reconcilePayments(db, paymentGatewayConfig(env), 40),
    sweepStuckGenerations(db, env, 30),
  ]);
  return json({ ok: true, payments, generations, ranAt: Date.now() });
}

export async function GET(request: Request) {
  try {
    return await run(request);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return await run(request);
  } catch (error) {
    return errorResponse(error);
  }
}
