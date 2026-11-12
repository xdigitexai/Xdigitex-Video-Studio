import { guardMutation, requireUser } from "@/lib/server/context";
import { getPayment, paymentView, pollPayment } from "@/lib/server/payments/service";
import { paymentGatewayConfig } from "@/lib/server/payments/xdigitex";
import { ApiError, errorResponse, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { db, env, actor } = await requireUser(request);
    await guardMutation(request, db, "payment-poll", 90, 60_000);
    const { id } = await params;
    const payment = await getPayment(db, id);
    if (!payment || payment.user_id !== actor.user.id) {
      throw new ApiError(404, "Payment not found.", "PAYMENT_NOT_FOUND");
    }
    if (payment.status === "pending" && payment.provider_checkout_id) {
      try {
        await pollPayment(db, payment.id, paymentGatewayConfig(env));
      } catch {
        // The gateway may be temporarily unreachable; report the last known state.
      }
    }
    const current = await getPayment(db, id);
    return json({ payment: paymentView(current!) });
  } catch (error) {
    return errorResponse(error);
  }
}
