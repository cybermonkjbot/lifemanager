"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type BillingRestoreCardProps = {
  billingStatus: "past_due" | "paused" | "canceled" | "trialing" | "active" | "self_hosted" | "unknown";
  plan: "personal_connector" | "business_whatsapp";
};

function statusTitle(status: BillingRestoreCardProps["billingStatus"]) {
  if (status === "past_due") {
    return "Your Subscription Did Not Go Through";
  }
  if (status === "canceled") {
    return "Your Subscription Is Canceled";
  }
  return "Your Free Trial Is Over";
}

function statusBody(status: BillingRestoreCardProps["billingStatus"]) {
  if (status === "past_due") {
    return "Update your payment to keep using the app.";
  }
  if (status === "canceled") {
    return "Restart your subscription to keep using the app.";
  }
  return "Choose a plan to keep using the app.";
}

export function BillingRestoreCard({ billingStatus, plan }: BillingRestoreCardProps) {
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const startedRef = useRef(false);

  const startCheckout = useCallback(async () => {
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
  }, [plan]);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    void startCheckout();
  }, [startCheckout]);

  return (
    <div className="billing-restore-panel">
      <p className="instance-lock-kicker">Billing</p>
      <h1 className="panel-title">{statusTitle(billingStatus)}</h1>
      <p className="instance-lock-copy">{statusBody(billingStatus)}</p>
      <p className="instance-lock-status" aria-live="polite">
        {busy ? "Opening payment..." : "Payment did not open automatically."}
      </p>
      {error ? <p className="instance-lock-error">{error}</p> : null}
      <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void startCheckout()}>
        {busy ? "Opening..." : "Open payment"}
      </button>
    </div>
  );
}
