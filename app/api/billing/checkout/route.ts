import { guardMutation, requireUser } from "@/lib/server/context";
import { getPlan, getEntitlements } from "@/lib/server/plans";
import { createPayment, paymentView, startCheckout, type CheckoutInput } from "@/lib/server/payments/service";
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
    await guardMutation(request, db, "checkout", 8, 60_000);
    const body = await readJson<{
      kind?: string;
      planId?: string;
      packageId?: string;
      phoneNumber?: string;
      gateway?: string;
    }>(request);
    const kind = body.kind === "topup" ? "topup" : "plan";
    const gateway = body.gateway === "card" ? "card" : body.gateway === "mobile" ? "mobile" : null;
    if (!gateway) {
      throw new ApiError(400, "Choose mobile money or card payment.", "INVALID_GATEWAY");
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
    const baseUrl = appBaseUrl(env, request);
    const nameParts = actor.user.display_name.trim().split(/\s+/);
    const firstName = nameParts[0] || "Malaba";
    const lastName = nameParts.slice(1).join(" ").slice(0, 60) || "Creator";
    const checkoutInput: Omit<CheckoutInput, "payment" | "description"> = {
      gateway,
      phoneNumber: detected.internationalNumber,
      email: actor.user.email,
      firstName,
      lastName,
      config,
      callbackUrl: `${baseUrl}/billing?payment=returned`,
      webhookUrl: `${baseUrl}/api/webhooks/xdigitex-pay`,
    };

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
      const amountLocal = Math.max(1, Math.round((pack.price_cents / 100) * rate));
      const created = await createPayment(db, {
        userId: actor.user.id,
        purpose: "credit_topup",
        packageId: pack.id,
        credits: pack.credits + pack.bonus_credits,
        priceUsdCents: pack.price_cents,
        currency: detected.currency,
        localAmount: amountLocal,
        metadata: {
          packageName: pack.name,
          country: detected.country,
          network: detected.networks[0] ?? null,
          dialCode: detected.dialCode,
          usdToLocalRate: rate,
        },
      });
      const checkout = await startCheckout(db, {
        payment: created.payment,
        ...checkoutInput,
        description: `Malaba AI Studio credits: ${pack.name}`,
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
        priceUsd: created.payment.price_usd_cents / 100,
        credits: created.payment.credits,
      });
    }

    const planId = safeString(body.planId, 80);
    const plan = await getPlan(db, planId);
    if (!plan || !plan.is_active) throw new ApiError(404, "Plan not found.", "PLAN_NOT_FOUND");
    const entitlements = await getEntitlements(db, actor.user.id);
    const samePlan = entitlements.plan?.id === plan.id && entitlements.status === "active";
    const purpose = samePlan ? "subscription_renewal" : entitlements.plan ? "plan_change" : "subscription";
    const amountLocal = Math.max(1, Math.round((plan.price_cents / 100) * rate));
    const created = await createPayment(db, {
      userId: actor.user.id,
      purpose,
      planId: plan.id,
      subscriptionId: entitlements.subscription?.id ?? null,
      credits: plan.credits_per_period,
      priceUsdCents: plan.price_cents,
      currency: detected.currency,
      localAmount: amountLocal,
      metadata: {
        planCode: plan.code,
        planName: plan.name,
        usdToKesRate: settings.usd_to_kes_rate_micros,
        usdToLocalRate: rate,
        country: detected.country,
        network: detected.networks[0] ?? null,
        dialCode: detected.dialCode,
      },
    });
    const checkout = await startCheckout(db, {
      payment: created.payment,
      ...checkoutInput,
      description: `Malaba AI Studio ${plan.name} plan`,
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
      priceUsd: created.payment.price_usd_cents / 100,
      credits: created.payment.credits,
      purpose,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
