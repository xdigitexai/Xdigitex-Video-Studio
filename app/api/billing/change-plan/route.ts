import { auditRequest, guardMutation, requireUser } from "@/lib/server/context";
import { getEntitlements, getPlan, latestSubscription, schedulePlanChange } from "@/lib/server/plans";
import { createPayment, paymentView, startCheckout } from "@/lib/server/payments/service";
import { normaliseKenyanPhone, paymentGatewayConfig } from "@/lib/server/payments/xdigitex";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { safeString } from "@/lib/server/util";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { db, env, actor } = await requireUser(request);
    await guardMutation(request, db, "change-plan", 8, 60_000);
    const body = await readJson<{ planId?: string; mode?: string; phoneNumber?: string }>(request);
    const plan = await getPlan(db, safeString(body.planId, 80));
    if (!plan || !plan.is_active) throw new ApiError(404, "Plan not found.", "PLAN_NOT_FOUND");
    const entitlements = await getEntitlements(db, actor.user.id);
    if (!entitlements.subscription || !entitlements.plan) {
      throw new ApiError(402, "Subscribe to a plan first.", "SUBSCRIPTION_REQUIRED");
    }
    if (entitlements.plan.id === plan.id) {
      throw new ApiError(400, "You are already on this plan.", "SAME_PLAN");
    }
    const subscription = await latestSubscription(db, actor.user.id);
    if (!subscription) throw new ApiError(402, "Subscribe to a plan first.", "SUBSCRIPTION_REQUIRED");

    if (body.mode === "period_end") {
      await schedulePlanChange(db, subscription, plan.id);
      await auditRequest(db, request, actor, "subscription.plan_change_scheduled", "subscription", subscription.id, {
        planId: plan.id,
      });
      return json({
        scheduled: true,
        effectiveAt: subscription.current_period_end,
        plan: { id: plan.id, name: plan.name },
      });
    }

    const phone = normaliseKenyanPhone(String(body.phoneNumber ?? ""));
    if (!phone) {
      throw new ApiError(400, "Enter a valid Kenyan M-Pesa number.", "INVALID_PHONE");
    }
    const config = paymentGatewayConfig(env);
    if (!config) {
      throw new ApiError(503, "Payments are not configured yet.", "PAYMENT_NOT_CONFIGURED");
    }
    const created = await createPayment(db, {
      userId: actor.user.id,
      purpose: "plan_change",
      planId: plan.id,
      subscriptionId: subscription.id,
      credits: plan.credits_per_period,
      priceUsdCents: plan.price_cents,
      metadata: { previousPlanId: entitlements.plan.id, planCode: plan.code, planName: plan.name, mode: "immediate" },
    });
    const checkout = await startCheckout(db, {
      payment: created.payment,
      phoneNumber: phone,
      description: `Xdigitex ${plan.name} upgrade`,
      config,
    });
    return json({
      payment: paymentView(checkout.payment),
      checkoutRequestId: checkout.checkoutRequestId,
      message: checkout.message,
      amountKes: checkout.payment.amount_minor / 100,
      priceUsd: checkout.payment.price_usd_cents / 100,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
