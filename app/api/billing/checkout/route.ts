import { guardMutation, requireUser } from "@/lib/server/context";
import { getPlan, getEntitlements } from "@/lib/server/plans";
import { createPayment, paymentView, startCheckout } from "@/lib/server/payments/service";
import { paymentGatewayConfig, normaliseKenyanPhone } from "@/lib/server/payments/xdigitex";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { getPricingSettings } from "@/lib/server/settings";
import { safeString } from "@/lib/server/util";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { db, env, actor } = await requireUser(request);
    await guardMutation(request, db, "checkout", 8, 60_000);
    const body = await readJson<{ kind?: string; planId?: string; packageId?: string; phoneNumber?: string }>(
      request,
    );
    const kind = body.kind === "topup" ? "topup" : "plan";
    const phone = normaliseKenyanPhone(String(body.phoneNumber ?? ""));
    if (!phone) {
      throw new ApiError(400, "Enter a valid Kenyan M-Pesa number, e.g. 0712 345 678.", "INVALID_PHONE");
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

    if (kind === "topup") {
      const packageId = safeString(body.packageId, 80);
      const pack = await db.first<{
        id: string;
        name: string;
        credits: number;
        bonus_credits: number;
        price_cents: number;
        is_active: number;
      }>(`SELECT * FROM credit_packages WHERE id = ? LIMIT 1`, [packageId]);
      if (!pack || !pack.is_active) throw new ApiError(404, "Credit pack not found.", "PACKAGE_NOT_FOUND");
      const created = await createPayment(db, {
        userId: actor.user.id,
        purpose: "credit_topup",
        packageId: pack.id,
        credits: pack.credits + pack.bonus_credits,
        priceUsdCents: pack.price_cents,
        metadata: { packageName: pack.name },
      });
      const checkout = await startCheckout(db, {
        payment: created.payment,
        phoneNumber: phone,
        description: `Xdigitex credits: ${pack.name}`,
        config,
      });
      return json({
        payment: paymentView(checkout.payment),
        checkoutRequestId: checkout.checkoutRequestId,
        message: checkout.message,
        amountKes: checkout.payment.amount_minor / 100,
        priceUsd: checkout.payment.price_usd_cents / 100,
        credits: checkout.payment.credits,
      });
    }

    const planId = safeString(body.planId, 80);
    const plan = await getPlan(db, planId);
    if (!plan || !plan.is_active) throw new ApiError(404, "Plan not found.", "PLAN_NOT_FOUND");
    const entitlements = await getEntitlements(db, actor.user.id);
    const samePlan = entitlements.plan?.id === plan.id && entitlements.status === "active";
    const purpose = samePlan ? "subscription_renewal" : entitlements.plan ? "plan_change" : "subscription";
    const created = await createPayment(db, {
      userId: actor.user.id,
      purpose,
      planId: plan.id,
      subscriptionId: entitlements.subscription?.id ?? null,
      credits: plan.credits_per_period,
      priceUsdCents: plan.price_cents,
      metadata: { planCode: plan.code, planName: plan.name, usdToKesRate: settings.usd_to_kes_rate_micros },
    });
    const checkout = await startCheckout(db, {
      payment: created.payment,
      phoneNumber: phone,
      description: `Xdigitex ${plan.name} plan`,
      config,
    });
    return json({
      payment: paymentView(checkout.payment),
      checkoutRequestId: checkout.checkoutRequestId,
      message: checkout.message,
      amountKes: checkout.payment.amount_minor / 100,
      priceUsd: checkout.payment.price_usd_cents / 100,
      credits: checkout.payment.credits,
      purpose,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
