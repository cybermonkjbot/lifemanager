"use client";

import { useRuntimeStatus } from "@/components/runtime-status-provider";
import { useState } from "react";

type SetupStatus =
  | "idle"
  | "starting"
  | "authenticating"
  | "qr_ready"
  | "code_ready"
  | "challenge_required"
  | "syncing"
  | "connected"
  | "error";

type SetupSnapshot = {
  status?: SetupStatus;
  message?: string;
  hasAuth?: boolean;
  hasConnectedBefore?: boolean;
  listenerActive?: boolean;
  listenerMessage?: string;
} | null;

type RuntimeState = "normal" | "paused" | "offline" | "error";

type ProviderIssue = {
  provider: "whatsapp" | "instagram";
  state: Exclude<RuntimeState, "normal" | "paused">;
  detail: string;
  hasAuth: boolean;
};

const TRANSITIONAL_SETUP_STATES = new Set<SetupStatus>([
  "starting",
  "authenticating",
  "qr_ready",
  "code_ready",
  "challenge_required",
  "syncing",
]);

function compactMessage(value: string | undefined, maxChars: number) {
  const trimmed = (value || "").replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function evaluateProviderState(provider: "whatsapp" | "instagram", setup: SetupSnapshot) {
  const label = provider === "whatsapp" ? "WhatsApp" : "Instagram";
  if (!setup) {
    return provider === "whatsapp"
      ? {
          provider,
          state: "offline" as const,
          detail: `${label} is not connected yet.`,
          hasAuth: false,
        }
      : null;
  }

  const status = setup.status || "idle";
  const listenerActive = setup.listenerActive === true;
  const hasAuth = setup.hasAuth === true;
  const hasConnectedBefore = setup.hasConnectedBefore === true || hasAuth || status === "connected";
  const combinedMessage = compactMessage(
    [setup.message, setup.listenerMessage].filter(Boolean).join(" · "),
    220,
  );

  if (status === "error") {
    if (provider === "instagram" && !hasAuth) {
      return null;
    }
    return {
      provider,
      state: "error" as const,
      detail: combinedMessage || `${label} has a setup error.`,
      hasAuth,
    };
  }

  if (listenerActive) {
    return null;
  }

  if (TRANSITIONAL_SETUP_STATES.has(status)) {
    return null;
  }

  if (provider === "instagram" && !hasAuth) {
    return null;
  }

  return {
    provider,
    state: "offline" as const,
    detail:
      provider === "whatsapp" && hasConnectedBefore && !hasAuth
        ? "WhatsApp is disconnected. Reconnect WhatsApp to resume automation."
        : combinedMessage || `${label} is currently offline.`,
    hasAuth,
  };
}

export function RuntimeStateOverlay({ canManageRuntime = true }: { canManageRuntime?: boolean }) {
  const [reconnectPending, setReconnectPending] = useState(false);
  const [reconnectError, setReconnectError] = useState("");
  const runtimeStatus = useRuntimeStatus();

  if (runtimeStatus == null) {
    return null;
  }

  const whatsappSetup = runtimeStatus.providers.whatsapp as SetupSnapshot;
  const instagramSetup = runtimeStatus.providers.instagram as SetupSnapshot;

  const issues = [
    evaluateProviderState("whatsapp", whatsappSetup),
    evaluateProviderState("instagram", instagramSetup),
  ].filter(Boolean) as ProviderIssue[];

  const autonomyPaused = Boolean(runtimeStatus.autonomyPaused);
  const hasError = issues.some((issue) => issue.state === "error");
  const hasOffline = issues.some((issue) => issue.state === "offline");
  const whatsappIssue = issues.find((issue) => issue.provider === "whatsapp");

  const state: RuntimeState = hasError ? "error" : hasOffline ? "offline" : autonomyPaused ? "paused" : "normal";

  if (state === "normal") {
    return null;
  }

  const title = state === "error" ? "Connection Error" : state === "offline" ? "Connection Offline" : "Automation Paused";
  const detail =
    state === "paused"
      ? "Automation is paused. Resume it when you are ready to send automatically."
      : compactMessage(issues.map((issue) => issue.detail).join(" | "), 260);
  const showWhatsAppReconnect = canManageRuntime && Boolean(whatsappIssue) && state !== "paused";

  const reconnectWhatsApp = async () => {
    if (!whatsappIssue) {
      return;
    }
    setReconnectError("");
    if (!whatsappIssue.hasAuth) {
      window.location.href = "/setup?connect=whatsapp";
      return;
    }
    setReconnectPending(true);
    try {
      const response = await fetch("/api/setup/whatsapp/restart-worker", {
        method: "POST",
      });
      const payload = (await response.json()) as { status?: string; message?: string; redirectPath?: string; error?: string };
      if (!response.ok || payload.status === "error") {
        if (payload.redirectPath) {
          window.location.href = payload.redirectPath;
          return;
        }
        throw new Error(payload.message || payload.error || "Could not reconnect WhatsApp.");
      }
    } catch (error) {
      setReconnectError(error instanceof Error ? error.message : "Could not reconnect WhatsApp.");
    } finally {
      setReconnectPending(false);
    }
  };

  return (
    <div className={`runtime-state-overlay runtime-state-${state}`} aria-live="polite">
      <div className="runtime-state-backdrop" />
      <div className="runtime-state-banner">
        <div className="runtime-state-copy">
          <p className="runtime-state-title">{title}</p>
          <p className="runtime-state-detail">{detail}</p>
          {reconnectError ? (
            <p className="runtime-state-action-error" role="alert">
              {reconnectError}
            </p>
          ) : null}
        </div>
        {showWhatsAppReconnect ? (
          <button
            type="button"
            className="btn btn-primary runtime-state-action"
            onClick={reconnectWhatsApp}
            disabled={reconnectPending}
            aria-disabled={reconnectPending}
          >
            {reconnectPending ? "Reconnecting..." : whatsappIssue?.hasAuth ? "Reconnect WhatsApp" : "Connect WhatsApp"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
