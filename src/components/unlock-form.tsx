"use client";

import { FormEvent, useMemo, useState } from "react";

type UnlockStep = "email" | "pin";

type UnlockFormProps = {
  hosted: boolean;
  step: UnlockStep;
  next: string;
  initialEmail: string;
  initialErrorMessage: string | null;
};

type LoginResponse = {
  ok?: boolean;
  next?: string;
  message?: string;
  paymentRequired?: boolean;
};

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim().toLowerCase());
}

export function UnlockForm(props: UnlockFormProps) {
  const [email, setEmail] = useState(props.initialEmail);
  const [pin, setPin] = useState("");
  const [errorMessage, setErrorMessage] = useState(props.initialErrorMessage);
  const [statusMessage, setStatusMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);

  const submitEmail = (event: FormEvent<HTMLFormElement>) => {
    if (submitting) {
      event.preventDefault();
      return;
    }
    if (!isValidEmail(normalizedEmail)) {
      event.preventDefault();
      setErrorMessage("Enter a valid email address.");
      setStatusMessage("");
      return;
    }
    event.preventDefault();
    setErrorMessage(null);
    setStatusMessage("Checking your account...");
    setSubmitting(true);
    const params = new URLSearchParams({
      next: props.next,
      email: normalizedEmail,
    });
    window.location.assign(`/unlock?${params.toString()}`);
  };

  const submitPin = async (event: FormEvent<HTMLFormElement>) => {
    if (submitting) {
      event.preventDefault();
      return;
    }
    if (!pin.trim()) {
      event.preventDefault();
      setErrorMessage("Enter your PIN.");
      setStatusMessage("");
      return;
    }

    event.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);
    setStatusMessage("Logging you in...");

    try {
      const form = new FormData();
      form.set("next", props.next);
      form.set("email", normalizedEmail);
      form.set("pin", pin);
      const response = await fetch("/api/auth/pin", {
        method: "POST",
        body: form,
        headers: {
          Accept: "application/json",
          "X-Requested-With": "fetch",
        },
      });
      const payload = (await response.json().catch(() => ({}))) as LoginResponse;
      if (response.status === 402 && payload.paymentRequired && payload.next) {
        setStatusMessage("Opening billing...");
        window.location.assign(payload.next);
        return;
      }
      if (!response.ok || !payload.ok) {
        setErrorMessage(payload.message || "That email and PIN do not match an account.");
        setStatusMessage("");
        setPin("");
        setSubmitting(false);
        return;
      }
      setStatusMessage("Login complete. Opening dashboard...");
      window.location.assign(payload.next || props.next || "/");
    } catch {
      setErrorMessage("Could not reach the local app. Check your connection and try again.");
      setStatusMessage("");
      setSubmitting(false);
    }
  };

  if (props.step === "email") {
    return (
      <form action="/unlock" method="get" className="instance-lock-form" onSubmit={submitEmail}>
        <input type="hidden" name="next" value={props.next} />
        <label className="instance-lock-field">
          <span className="queue-meta">Email</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setErrorMessage(null);
            }}
            disabled={submitting}
            autoFocus
            required
          />
        </label>
        <p className="instance-lock-status" aria-live="polite">
          {statusMessage || " "}
        </p>
        {errorMessage ? <p className="instance-lock-error">{errorMessage}</p> : null}
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "Checking..." : "Continue"}
        </button>
      </form>
    );
  }

  return (
    <form action="/api/auth/pin" method="post" className="instance-lock-form" onSubmit={submitPin}>
      <input type="hidden" name="next" value={props.next} />
      <input type="hidden" name="email" value={normalizedEmail} />
      {props.hosted ? (
        <label className="instance-lock-field">
          <span className="queue-meta">Email</span>
          <input type="email" value={normalizedEmail} readOnly aria-readonly="true" />
        </label>
      ) : null}
      <label className="instance-lock-field">
        <span className="queue-meta">PIN</span>
        <input
          type="password"
          name="pin"
          inputMode="numeric"
          autoComplete="current-password"
          placeholder="Enter your PIN"
          value={pin}
          onChange={(event) => {
            setPin(event.target.value);
            setErrorMessage(null);
          }}
          disabled={submitting}
          autoFocus
          required
        />
      </label>
      <p className="instance-lock-status" aria-live="polite">
        {statusMessage || " "}
      </p>
      {errorMessage ? <p className="instance-lock-error">{errorMessage}</p> : null}
      <div className="instance-lock-actions">
        {props.hosted ? (
          <a
            className={`btn btn-ghost${submitting ? " btn-disabled" : ""}`}
            href={`/unlock?next=${encodeURIComponent(props.next)}`}
            aria-disabled={submitting}
          >
            Change email
          </a>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "Logging in..." : "Unlock"}
        </button>
      </div>
    </form>
  );
}
