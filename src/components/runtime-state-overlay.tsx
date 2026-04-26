"use client";

import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";

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
  listenerActive?: boolean;
  listenerMessage?: string;
} | null;

type RuntimeState = "normal" | "paused" | "offline" | "error";

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
          state: "offline" as const,
          detail: `${label} is not connected yet.`,
        }
      : null;
  }

  const status = setup.status || "idle";
  const listenerActive = setup.listenerActive === true;
  const hasAuth = setup.hasAuth === true;
  const combinedMessage = compactMessage(
    [setup.message, setup.listenerMessage].filter(Boolean).join(" · "),
    220,
  );

  if (status === "error") {
    if (provider === "instagram" && !hasAuth) {
      return null;
    }
    return {
      state: "error" as const,
      detail: combinedMessage || `${label} has a setup error.`,
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
    state: "offline" as const,
    detail: combinedMessage || `${label} is currently offline.`,
  };
}

export function RuntimeStateOverlay() {
  const whatsappSetup = useQuery(api.system.setupStatus, { provider: "whatsapp" }) as SetupSnapshot | undefined;
  const instagramSetup = useQuery(api.system.setupStatus, { provider: "instagram" }) as SetupSnapshot | undefined;
  const health = useQuery(api.system.health, {}) as
    | {
        config?: {
          autonomyPaused?: boolean;
        };
      }
    | undefined;

  if (whatsappSetup === undefined || instagramSetup === undefined || health === undefined) {
    return null;
  }

  const issues = [
    evaluateProviderState("whatsapp", whatsappSetup),
    evaluateProviderState("instagram", instagramSetup),
  ].filter(Boolean) as Array<{ state: Exclude<RuntimeState, "normal" | "paused">; detail: string }>;

  const autonomyPaused = Boolean(health?.config?.autonomyPaused);
  const hasError = issues.some((issue) => issue.state === "error");
  const hasOffline = issues.some((issue) => issue.state === "offline");

  const state: RuntimeState = hasError ? "error" : hasOffline ? "offline" : autonomyPaused ? "paused" : "normal";

  if (state === "normal") {
    return null;
  }

  const title = state === "error" ? "Connection Error" : state === "offline" ? "Connection Offline" : "Automation Paused";
  const detail =
    state === "paused"
      ? "Automation is paused. Resume it when you are ready to send automatically."
      : compactMessage(issues.map((issue) => issue.detail).join(" | "), 260);

  return (
    <div className={`runtime-state-overlay runtime-state-${state}`} aria-live="polite">
      <div className="runtime-state-backdrop" />
      <div className="runtime-state-banner">
        <p className="runtime-state-title">{title}</p>
        <p className="runtime-state-detail">{detail}</p>
      </div>
    </div>
  );
}
