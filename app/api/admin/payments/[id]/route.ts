import { auditRequest, guardMutation, requireAdmin } from "@/lib/server/context";
import { getPayment, pollPayment, refundPayment } from "@/lib/server/payments/service";
import { paymentGatewayConfig } from "@/lib/server/payments/xdigitex";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { safeString } from "@/lib/server/util";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { db, env, actor } = await requireAdmin(request);
    await guardMutation(request, db, "admin-payment-action", 30, 60_000);
    const { id } = await params;
    const payment = await getPayment(db, id);
    if (!payment) throw new ApiError(404, "Payment not found.", "PAYMENT_NOT_FOUND");
    const body = await readJson<{ action?: string; reason?: string }>(request);
    if (body.action === "refund") {
      const result = await refundPayment(db, id, { id: actor.user.id, email: actor.user.email }, safeString(body.reason, 300) || "Administrative refund");
      return json(result);
    }
    if (body.action === "reconcile") {
      const config = paymentGatewayConfig(env);
      if (!config) throw new ApiError(503, "Payment gateway is not configured.", "PAYMENT_NOT_CONFIGURED");
      const result = await pollPayment(db, id, config);
      await auditRequest(db, request, actor, "admin.payment_reconciled", "payment", id, {
        status: result.payment.status,
        applied: result.applied,
      });
      return json({
        applied: result.applied,
        status: result.payment.status,
        alreadyCompleted: result.alreadyCompleted,
        error: result.error,
      });
    }
    throw new ApiError(400, "Unknown payment action.", "INVALID_ACTION");
  } catch (error) {
    return errorResponse(error);
  }
}
