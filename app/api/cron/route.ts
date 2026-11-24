import { emailAlreadySent } from "@/lib/server/email";
import { emailConfig, trySendRenderedEmail } from "@/lib/server/email-notifications";
import { subscriptionExpiringEmail } from "@/lib/server/email-templates";
import { errorResponse, json } from "@/lib/server/http";
import { getPlan } from "@/lib/server/plans";
import { reconcilePayments } from "@/lib/server/payments/service";
import { paymentGatewayConfig } from "@/lib/server/payments/xdigitex";
import { dbFromRequestEnv, runtimeEnv, type RuntimeEnv } from "@/lib/server/runtime";
import { sweepStuckGenerations } from "@/lib/server/generation";
import type { Db } from "@/lib/server/db";

export const dynamic = "force-dynamic";

/**
 * Scheduled maintenance endpoint for Cloudflare Cron Triggers (or an external
 * scheduler). Protected by a dedicated secret; no session is involved.
 */
async function notifyExpiringSubscriptions(db: Db, env: RuntimeEnv): Promise<number> {
  const nowMs = Date.now();
  const horizon = nowMs + 72 * 60 * 60 * 1000;
  const rows = await db.all<{
    id: string;
    user_id: string;
    plan_id: string;
    current_period_end: number;
    email: string;
    display_name: string;
  }>(
    `SELECT s.id, s.user_id, s.plan_id, s.current_period_end, u.email, u.display_name
     FROM subscriptions s JOIN users u ON u.id = s.user_id
     WHERE s.status = 'active' AND s.cancel_at_period_end = 0
       AND s.current_period_end > ? AND s.current_period_end <= ?
     ORDER BY s.current_period_end ASC LIMIT 200`,
    [nowMs, horizon],
  );
  const config = emailConfig(env);
  let sent = 0;
  for (const row of rows) {
    if (await emailAlreadySent(db, "subscription_expiring", row.id)) continue;
    const plan = await getPlan(db, row.plan_id);
    const result = await trySendRenderedEmail(
      db,
      config,
      row.email,
      "subscription_expiring",
      subscriptionExpiringEmail({
        name: row.display_name,
        plan: plan?.name || "Current plan",
        expiry: row.current_period_end,
        siteUrl: env.APP_URL,
      }),
    );
    if (result?.delivered) sent += 1;
  }
  return sent;
}

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
  const [payments, generations, expiringNotices] = await Promise.all([
    reconcilePayments(db, paymentGatewayConfig(env), 40),
    sweepStuckGenerations(db, env, 30),
    notifyExpiringSubscriptions(db, env),
  ]);
  return json({ ok: true, payments, generations, expiringNotices, ranAt: Date.now() });
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
