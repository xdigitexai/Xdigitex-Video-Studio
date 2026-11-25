import { auditRequest, guardMutation, requireUser } from "@/lib/server/context";
import { getEntitlements, getPlan, latestSubscription, schedulePlanChange } from "@/lib/server/plans";
import { createPayment, paymentView, startCheckout } from "@/lib/server/payments/service";
import { paymentGatewayConfig } from "@/lib/server/payments/xdigitex";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { getPricingSettings } from "@/lib/server/settings";
import { safeString } from "@/lib/server/util";
import { appBaseUrl } from "@/lib/server/runtime";
import { detectPaymentNumber, rateForCurrency } from "@/lib/payment-countries";

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

    const detected = detectPaymentNumber(String(body.phoneNumber ?? ""));
    if (!detected) {
      throw new ApiError(
        400,
        "Enter a valid phone number with country code, e.g. +254712345678.",
        "INVALID_PHONE",
      );
    }
    const config = paymentGatewayConfig(env);
    if (!config) {
      throw new ApiError(
        503,
        "Payments are not configured yet. Add XDIGITEX_PAY_API_KEY on the server.",
        "PAYMENT_NOT_CONFIGURED",
      );
    }
    const settings = await getPricingSettings(db);
    const rate = rateForCurrency(detected.currency, settings.usd_to_kes_rate_micros / 1_000_000);
    if (!rate) {
      throw new ApiError(400, "Your country's currency is not supported for payments.", "UNSUPPORTED_CURRENCY");
    }
    const amountLocal = Math.max(1, Math.round((plan.price_cents / 100) * rate));
    const created = await createPayment(db, {
      userId: actor.user.id,
      purpose: "plan_change",
      planId: plan.id,
      subscriptionId: subscription.id,
      credits: plan.credits_per_period,
      priceUsdCents: plan.price_cents,
      currency: detected.currency,
      localAmount: amountLocal,
      metadata: {
        previousPlanId: entitlements.plan.id,
        planCode: plan.code,
        planName: plan.name,
        mode: "immediate",
        country: detected.country,
        network: detected.networks[0] ?? null,
        dialCode: detected.dialCode,
        usdToLocalRate: rate,
      },
    });

    const baseUrl = appBaseUrl(env, request);
    const nameParts = actor.user.display_name.trim().split(/\s+/);
    const checkout = await startCheckout(db, {
      payment: created.payment,
      gateway: "mobile",
      phoneNumber: detected.internationalNumber,
      email: actor.user.email,
      firstName: nameParts[0] || "Malaba",
      lastName: nameParts.slice(1).join(" ").slice(0, 60) || "Creator",
      description: `Malaba AI Studio ${plan.name} upgrade`,
      config,
      callbackUrl: `${baseUrl}/billing?payment=returned`,
      webhookUrl: `${baseUrl}/api/webhooks/xdigitex-pay`,
    });
    return json({
      payment: paymentView(checkout.payment),
      checkoutReference: checkout.checkoutReference,
      redirectUrl: checkout.redirectUrl,
      message: checkout.message,
      currency: detected.currency,
      country: detected.country,
      network: detected.networks[0] ?? null,
      amountLocal,
      priceUsd: checkout.payment.price_usd_cents / 100,
      credits: checkout.payment.credits,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
