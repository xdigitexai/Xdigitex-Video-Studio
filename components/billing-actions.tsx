"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CreditCard,
  ExternalLink,
  LoaderCircle,
  Smartphone,
  Sparkles,
} from "lucide-react";
import {
  detectPaymentNumber,
  formatLocalMoney,
  localAmountFromUsd,
  type PaymentGateway,
} from "@/lib/payment-countries";

export interface PlanLite {
  id: string;
  code: string;
  name: string;
  description: string;
  priceUsd: number;
  credits: number;
  videoLimit: number;
  imageLimit: number;
  maxDuration: number;
  resolutions: string[];
  features: string[];
}

export interface PackLite {
  id: string;
  name: string;
  credits: number;
  bonus: number;
  priceUsd: number;
}

interface PaymentState {
  id: string;
  reference: string;
  status: string;
  amountLocal: number;
  amountKes: number | null;
  currency: string;
  gateway: string | null;
  redirectUrl?: string | null;
  priceUsd: number;
  credits: number;
  receipt?: string | null;
  failureReason?: string | null;
}

interface CheckoutResponse {
  error?: string;
  message?: string;
  payment?: PaymentState;
  redirectUrl?: string | null;
  country?: string;
  network?: string | null;
  currency?: string;
  amountLocal?: number;
}

export function BillingActions({
  plans,
  packages,
  currentPlanId,
  subscription,
  gatewayConfigured,
  currencyRates,
  renewalDue,
}: {
  plans: PlanLite[];
  packages: PackLite[];
  currentPlanId: string | null;
  subscription: { status: string; cancelAtPeriodEnd: boolean; periodEnd: number; pendingPlanId: string | null } | null;
  gatewayConfigured: boolean;
  currencyRates: Record<string, number>;
  renewalDue: boolean;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [gateway, setGateway] = useState<PaymentGateway>("mobile");
  const [packId, setPackId] = useState(packages[0]?.id ?? "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [payment, setPayment] = useState<PaymentState | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState("");
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const detected = useMemo(() => detectPaymentNumber(phone), [phone]);
  const currency = detected?.currency ?? "KES";
  const rate = detected ? currencyRates[detected.currency] ?? detected.usdRate : currencyRates.KES ?? 130;
  const localPrice = (usd: number) => localAmountFromUsd(usd, rate);

  async function poll(paymentId: string) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (cancelled.current) return;
      const response = await fetch(`/api/billing/payments/${paymentId}`, { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as { payment?: PaymentState; error?: string };
      if (!response.ok || !data.payment) {
        setError(data.error || "Could not check the payment status.");
        setBusy("");
        return;
      }
      setPayment(data.payment);
      if (data.payment.status === "completed") {
        setMessage(
          `Payment confirmed${data.payment.receipt ? ` · reference ${data.payment.receipt}` : ""}. Your account has been updated.`,
        );
        setCheckoutUrl("");
        setBusy("");
        router.refresh();
        return;
      }
      if (data.payment.status === "failed" || data.payment.status === "cancelled") {
        setError(data.payment.failureReason || `Payment ${data.payment.status}. No credits were added.`);
        setCheckoutUrl("");
        setBusy("");
        router.refresh();
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 3000));
    }
    setError("Still waiting for confirmation. Keep this page open, or check your payment history later.");
    setBusy("");
  }

  async function startCheckout(kind: "plan" | "topup", id: string) {
    setError("");
    setMessage("");
    setPayment(null);
    setCheckoutUrl("");
    setBusy(kind === "plan" ? id : `pack:${id}`);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          gateway,
          phoneNumber: phone,
          ...(kind === "plan" ? { planId: id } : { packageId: id }),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as CheckoutResponse;
      if (!response.ok || !data.payment) {
        setError(data.error || "Could not start the payment.");
        setBusy("");
        return;
      }
      setPayment(data.payment);
      if (data.redirectUrl) {
        setCheckoutUrl(data.redirectUrl);
        setMessage(
          `${data.country ? `${data.country} · ` : ""}${data.currency ?? data.payment.currency} ${data.amountLocal ?? data.payment.amountLocal}. Complete the payment on the secure card checkout page, then return here.`,
        );
        window.location.assign(data.redirectUrl);
      } else {
        setMessage(
          data.message ||
            `${data.network ? `Check your ${data.network} phone prompt` : "Check your phone"} and approve the payment to continue.`,
        );
      }
      await poll(data.payment.id);
    } catch {
      setError("Network error. Check your connection and try again.");
      setBusy("");
    }
  }

  async function subscriptionAction(action: "cancel" | "resume") {
    setBusy(action);
    setError("");
    try {
      const response = await fetch("/api/billing/subscription", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error || "Could not update the subscription.");
        return;
      }
      setMessage(action === "cancel" ? "Subscription will end at the current period." : "Subscription resumed.");
      router.refresh();
    } finally {
      setBusy("");
    }
  }

  async function scheduleDowngrade(planId: string) {
    setBusy(`down:${planId}`);
    setError("");
    try {
      const response = await fetch("/api/billing/change-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId, mode: "period_end" }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; effectiveAt?: number };
      if (!response.ok) {
        setError(data.error || "Could not schedule the plan change.");
        return;
      }
      setMessage(
        `Plan change scheduled for ${new Date(data.effectiveAt ?? Date.now()).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })}.`,
      );
      router.refresh();
    } finally {
      setBusy("");
    }
  }

  const currentPlan = plans.find((plan) => plan.id === currentPlanId) ?? null;

  return (
    <div className="stack">
      {error ? <div className="notice notice-error">{error}</div> : null}
      {message ? <div className="notice notice-success">{message}</div> : null}
      {payment && payment.status === "pending" ? (
        <div className="notice notice-info">
          <LoaderCircle className="spin" size={16} />
          <span>
            Waiting for gateway confirmation · {payment.reference} ·{" "}
            {formatLocalMoney(payment.amountLocal, payment.currency)}. Credits are added only after verified payment.
          </span>
        </div>
      ) : null}
      {checkoutUrl ? (
        <div className="notice notice-info">
          <ExternalLink size={16} />
          <span>
            Card checkout opened in a new step. If it did not open,{" "}
            <a href={checkoutUrl} target="_blank" rel="noreferrer">continue to secure checkout</a>.
          </span>
        </div>
      ) : null}
      {!gatewayConfigured ? (
        <div className="notice notice-warn">
          <AlertTriangle size={16} />
          <span>
            Online payments are not enabled yet. An administrator must configure the Pay Xdigitex API key before
            checkouts can run.
          </span>
        </div>
      ) : null}

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Payment details</h3>
            <p>Mobile money or card, processed by Pay Xdigitex.</p>
          </div>
          <span className="badge badge-muted">
            <span className="dot" /> {gateway === "card" ? "Card" : "Mobile money"}
          </span>
        </div>
        <div className="card-body">
          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            <button
              type="button"
              className={`btn ${gateway === "mobile" ? "btn-primary" : "btn-secondary"}`}
              style={{ flex: 1 }}
              onClick={() => setGateway("mobile")}
            >
              <Smartphone size={15} /> Mobile money
            </button>
            <button
              type="button"
              className={`btn ${gateway === "card" ? "btn-primary" : "btn-secondary"}`}
              style={{ flex: 1 }}
              onClick={() => setGateway("card")}
            >
              <CreditCard size={15} /> Card
            </button>
          </div>
          <div className="field" style={{ marginBottom: 8 }}>
            <label className="label" htmlFor="phone">Phone number (international format)</label>
            <input
              id="phone"
              className="input"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+254712345678"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
            <span className="hint">
              {detected
                ? `${detected.country} · ${detected.currency} · ${detected.networks.join(", ")}`
                : "Country, network and currency are detected from your country code."}
            </span>
          </div>
        </div>
      </div>

      <div className="plan-cards">
        {plans.map((plan) => {
          const current = plan.id === currentPlanId;
          const isUpgrade = currentPlan ? plan.priceUsd > currentPlan.priceUsd : true;
          const busyThis = busy === plan.id;
          return (
            <article className={`plan-card ${current ? "current" : ""}`} key={plan.id}>
              <div className="row-between">
                <h3>{plan.name}</h3>
                {current ? <span className="badge badge-lime">CURRENT</span> : null}
                {subscription?.pendingPlanId === plan.id ? <span className="badge badge-warn">SCHEDULED</span> : null}
              </div>
              <div className="price-tag">
                <b>${plan.priceUsd.toFixed(0)}</b>
                <span>/ month · {formatLocalMoney(localPrice(plan.priceUsd), currency)}</span>
              </div>
              <p className="muted small">{plan.description}</p>
              <ul className="price-list">
                <li><Check size={13} /> {plan.credits.toLocaleString()} credits / month</li>
                <li><Check size={13} /> {plan.videoLimit < 0 ? "Unlimited" : plan.videoLimit} videos · {plan.imageLimit < 0 ? "Unlimited" : plan.imageLimit} images</li>
                <li><Check size={13} /> {plan.maxDuration}s max clip · {plan.resolutions.join(", ") || "HD"}</li>
                {plan.features.slice(0, 2).map((feature) => (
                  <li key={feature}><Check size={13} /> {feature.replace(/_/g, " ")}</li>
                ))}
              </ul>
              <div className="row" style={{ gap: 8 }}>
                <button
                  className={`btn ${isUpgrade || !currentPlan ? "btn-primary" : "btn-secondary"}`}
                  style={{ flex: 1 }}
                  disabled={!gatewayConfigured || !detected || busy !== "" || current}
                  onClick={() => startCheckout("plan", plan.id)}
                >
                  {busyThis ? <LoaderCircle className="spin" size={15} /> : gateway === "card" ? <CreditCard size={15} /> : <Smartphone size={15} />}
                  {current ? "Active plan" : renewalDue && current ? "Pay renewal" : isUpgrade ? "Upgrade now" : "Switch plan"}
                </button>
                {current && subscription && !subscription.cancelAtPeriodEnd ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => subscriptionAction("cancel")} disabled={busy !== ""}>
                    {busy === "cancel" ? <LoaderCircle className="spin" size={13} /> : null} Cancel
                  </button>
                ) : null}
              </div>
              {currentPlan && !isUpgrade && !current ? (
                <button
                  className="btn btn-ghost btn-sm btn-block mt-1"
                  onClick={() => scheduleDowngrade(plan.id)}
                  disabled={busy !== ""}
                >
                  {busy === `down:${plan.id}` ? <LoaderCircle className="spin" size={13} /> : null}
                  Switch at period end
                </button>
              ) : null}
            </article>
          );
        })}
      </div>

      {subscription && subscription.status !== "active" ? (
        <div className="card card-pad">
          <div className="row-between wrap">
            <div>
              <span className="badge badge-warn">SUBSCRIPTION {subscription.status.replace("_", " ").toUpperCase()}</span>
              <p className="small muted mt-1">
                {subscription.cancelAtPeriodEnd
                  ? "Your plan ends at the close of this period. Resume to keep your benefits."
                  : "Your renewal is due. Pay the renewal below to keep generating without interruption."}
              </p>
            </div>
            {subscription.cancelAtPeriodEnd ? (
              <button className="btn btn-secondary" onClick={() => subscriptionAction("resume")} disabled={busy !== ""}>
                {busy === "resume" ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Resume plan
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Credit top-ups</h3>
            <p>One-time purchase. Purchased credits never expire.</p>
          </div>
          <CreditCard size={16} className="muted" />
        </div>
        <div className="card-body">
          <div className="pack-grid">
            {packages.map((pack) => (
              <button
                key={pack.id}
                className={`pack ${packId === pack.id ? "selected" : ""}`}
                onClick={() => setPackId(pack.id)}
                type="button"
              >
                <b>{(pack.credits + pack.bonus).toLocaleString()}</b>
                <span>credits{pack.bonus ? ` · incl. ${pack.bonus} bonus` : ""}</span>
                <strong>{formatLocalMoney(localPrice(pack.priceUsd), currency)}</strong>
              </button>
            ))}
          </div>
          <button
            className="btn btn-primary btn-block mt-3"
            disabled={!packId || !gatewayConfigured || !detected || busy !== ""}
            onClick={() => startCheckout("topup", packId)}
          >
            {busy === `pack:${packId}` ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}
            Buy credits with {gateway === "card" ? "card" : "mobile money"}
          </button>
          <p className="tiny muted mt-2">
            Credits are added only after the gateway verifies payment. A browser redirect is never treated as proof of
            payment.
          </p>
        </div>
      </div>
    </div>
  );
}
