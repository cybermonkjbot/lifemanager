"use client";

import { useState } from "react";

type BillingStatus = "trialing" | "active" | "past_due" | "paused" | "canceled" | "self_hosted" | "unknown";

type SubscriptionTrialBannerProps = {
  billingStatus: BillingStatus;
  trialEndsAt: number | null;
  plan: "personal_connector" | "business_whatsapp";
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WARNING_DAYS = 3;

function daysRemaining(expiresAt: number, now = Date.now()) {
  return Math.max(0, Math.ceil((expiresAt - now) / DAY_MS));
}

function buildBannerCopy(status: BillingStatus, trialEndsAt: number | null) {
  const now = Date.now();
  if (status === "paused") {
    return {
      tone: "critical" as const,
      title: "Your free trial has ended",
      body: "Choose a plan to keep using the hosted app.",
      cta: "Choose plan",
    };
  }
  if (status === "past_due") {
    return {
      tone: "critical" as const,
      title: "Your payment did not go through",
      body: "Update your payment to keep using the hosted app.",
      cta: "Update payment",
    };
  }
  if (status === "canceled") {
    return {
      tone: "critical" as const,
      title: "Your subscription is canceled",
      body: "Restart your subscription to keep using the hosted app.",
      cta: "Restart",
    };
  }
  if (status !== "trialing" || !trialEndsAt) {
    return null;
  }
  if (trialEndsAt <= now) {
    return {
      tone: "critical" as const,
      title: "Your free trial has ended",
      body: "Choose a plan to keep using the hosted app.",
      cta: "Choose plan",
    };
  }
  const remaining = daysRemaining(trialEndsAt, now);
  if (remaining > WARNING_DAYS) {
    return null;
  }
  return {
    tone: "warning" as const,
    title: remaining === 1 ? "Your free trial is about to end" : `Your free trial ends in ${remaining} days`,
    body: "Choose a plan now so your account keeps working.",
    cta: "Choose plan",
  };
}

export function SubscriptionTrialBanner({ billingStatus, trialEndsAt, plan }: SubscriptionTrialBannerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const copy = buildBannerCopy(billingStatus, trialEndsAt);

  if (!copy) {
    return null;
  }

  const startCheckout = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/billing/flutterwave/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const body = await response.json().catch(() => ({})) as { paymentLink?: string; error?: string };
      if (!response.ok || !body.paymentLink) {
        throw new Error(body.error || "Could not open payment.");
      }
      window.location.href = body.paymentLink;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open payment.");
      setBusy(false);
    }
  };

  return (
    <section className={`subscription-trial-banner subscription-trial-banner-${copy.tone}`} role="status" aria-live="polite">
      <div>
        <span>{copy.title}</span>
        <p>{copy.body}</p>
        {error ? <em role="alert">{error}</em> : null}
      </div>
      <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void startCheckout()}>
        {busy ? "Opening..." : copy.cta}
      </button>
    </section>
  );
}
