import { auditRequest, guardMutation, requireAdmin } from "@/lib/server/context";
import { reconcilePayments } from "@/lib/server/payments/service";
import { paymentGatewayConfig } from "@/lib/server/payments/xdigitex";
import { sweepStuckGenerations } from "@/lib/server/generation";
import { errorResponse, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Manual reconciliation for pending payments and stuck generation jobs. */
export async function POST(request: Request) {
  try {
    const { db, env, actor } = await requireAdmin(request);
    await guardMutation(request, db, "admin-sweep", 10, 60_000);
    const [payments, generations] = await Promise.all([
      reconcilePayments(db, paymentGatewayConfig(env), 50),
      sweepStuckGenerations(db, env, 30),
    ]);
    await auditRequest(db, request, actor, "admin.sweep", "system", "jobs", { payments, generations });
    return json({ ok: true, payments, generations });
  } catch (error) {
    return errorResponse(error);
  }
}
