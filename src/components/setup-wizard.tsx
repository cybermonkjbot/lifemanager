"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

type SetupStatus = "idle" | "starting" | "qr_ready" | "connected" | "error";

type SetupState = {
  status: SetupStatus;
  message: string;
  qrDataUrl?: string;
  updatedAt: number;
  hasAuth: boolean;
};

function statusLabel(status: SetupStatus) {
  if (status === "idle") return "Idle";
  if (status === "starting") return "Starting";
  if (status === "qr_ready") return "QR Ready";
  if (status === "connected") return "Connected";
  return "Error";
}

export function SetupWizard() {
  const [state, setState] = useState<SetupState | null>(null);
  const [busy, setBusy] = useState(false);

  const canStart = useMemo(() => {
    return state?.status === "idle" || state?.status === "error" || !state;
  }, [state]);

  const refresh = async () => {
    const response = await fetch("/api/setup/whatsapp/status", { cache: "no-store" });
    const next = (await response.json()) as SetupState;
    setState(next);
  };

  const startSetup = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/setup/whatsapp/start", {
        method: "POST",
      });
      const next = (await response.json()) as SetupState;
      setState(next);
    } finally {
      setBusy(false);
    }
  };

  const stopSetup = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/setup/whatsapp/stop", {
        method: "POST",
      });
      const next = (await response.json()) as SetupState;
      setState(next);
    } finally {
      setBusy(false);
    }
  };

  const resetSetup = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/setup/whatsapp/reset", {
        method: "POST",
      });
      const next = (await response.json()) as SetupState;
      setState(next);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, 2200);

    return () => clearInterval(interval);
  }, []);

  return (
    <section className="setup-wizard">
      <div className="setup-wizard-card">
        <p className="queue-meta">Wizard Status</p>
        <h3>WhatsApp Connection Setup</h3>
        <p className="queue-body">
          Use this wizard to generate a QR, scan with your phone, and persist credentials for the worker.
        </p>

        <div className="setup-status-row">
          <span className={`status-pill ${state?.status === "connected" ? "status-active" : "status-paused"}`}>
            {statusLabel(state?.status || "idle")}
          </span>
          <span className="queue-meta">{state?.message || "Loading status..."}</span>
        </div>

        <div className="wizard-actions">
          <button className="btn btn-primary" type="button" onClick={startSetup} disabled={busy || !canStart}>
            {busy ? "Working..." : "Start QR Session"}
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => void refresh()} disabled={busy}>
            Refresh
          </button>
          <button className="btn btn-ghost" type="button" onClick={stopSetup} disabled={busy}>
            Stop Session
          </button>
          <button className="btn btn-ghost" type="button" onClick={resetSetup} disabled={busy}>
            Reset Credentials
          </button>
        </div>

        {state?.status === "error" ? (
          <p className="queue-meta">
            If this keeps failing, stop <code>bun run worker</code>, click <strong>Reset Credentials</strong>, then start a new QR session.
          </p>
        ) : null}

        <div className="wizard-steps">
          <article className="wizard-step">
            <p className="queue-title">Step 1</p>
            <p className="queue-body">Click <strong>Start QR Session</strong>.</p>
          </article>
          <article className="wizard-step">
            <p className="queue-title">Step 2</p>
            <p className="queue-body">Open WhatsApp on phone, scan QR from this page.</p>
          </article>
          <article className="wizard-step">
            <p className="queue-title">Step 3</p>
            <p className="queue-body">When status becomes <strong>Connected</strong>, run <code>bun run worker</code>.</p>
          </article>
        </div>
      </div>

      <div className="setup-wizard-card">
        <p className="queue-meta">Pairing</p>
        <h3>QR Code</h3>

        {state?.qrDataUrl ? (
          <div className="qr-frame">
            <Image
              src={state.qrDataUrl}
              width={320}
              height={320}
              alt="WhatsApp setup QR code"
              unoptimized
            />
          </div>
        ) : (
          <p className="empty-line">QR code will appear here after starting setup.</p>
        )}

        <p className="queue-meta">
          Credentials found: {state?.hasAuth ? "Yes" : "No"}
        </p>
      </div>
    </section>
  );
}
