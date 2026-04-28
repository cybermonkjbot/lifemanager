"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type PreparationStatus = "idle" | "running" | "ready" | "skipped" | "error";

type PreparationState = {
  status: PreparationStatus;
  message: string;
  detail: string;
  progress: number;
  platform: string;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  lastError?: string;
};

type SetupPreparationProgressProps = {
  variant: "full" | "compact";
  startOnMount?: boolean;
  onDoLater?: () => void | Promise<void>;
  onMinimize?: () => void | Promise<void>;
  onDone?: () => void | Promise<void>;
};

const idleState: PreparationState = {
  status: "idle",
  message: "Ready to prepare OdogwuHQ.",
  detail: "Local tools can be installed now.",
  progress: 0,
  platform: "",
  updatedAt: 0,
  startedAt: null,
  completedAt: null,
};

async function readPreparationResponse(response: Response) {
  const body = (await response.json()) as PreparationState & { error?: string };
  if (!response.ok) {
    throw new Error(body.error || `Preparation request failed (${response.status})`);
  }
  return body;
}

function normalizeProgress(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function SetupPreparationProgress({
  variant,
  startOnMount = false,
  onDoLater,
  onMinimize,
  onDone,
}: SetupPreparationProgressProps) {
  const [state, setState] = useState<PreparationState>(idleState);
  const [hidden, setHidden] = useState(false);
  const [pending, setPending] = useState(false);
  const progress = normalizeProgress(state.progress);
  const active = state.status === "running";
  const visibleCompact = variant === "compact" && !hidden && (state.status === "running" || state.status === "error");

  const refresh = useCallback(async () => {
    const response = await fetch("/api/setup/preparation/status", { cache: "no-store" });
    const nextState = await readPreparationResponse(response);
    setState(nextState);
    return nextState;
  }, []);

  const start = useCallback(async () => {
    setPending(true);
    try {
      const response = await fetch("/api/setup/preparation/start", { method: "POST" });
      const nextState = await readPreparationResponse(response);
      setState(nextState);
      return nextState;
    } finally {
      setPending(false);
    }
  }, []);

  const skip = useCallback(async () => {
    setPending(true);
    try {
      const response = await fetch("/api/setup/preparation/skip", { method: "POST" });
      setState(await readPreparationResponse(response));
      await onDoLater?.();
    } finally {
      setPending(false);
    }
  }, [onDoLater]);

  useEffect(() => {
    let mounted = true;
    void refresh()
      .then((nextState) => {
        if (mounted && startOnMount && (nextState.status === "idle" || nextState.status === "skipped" || nextState.status === "error")) {
          void start().catch(() => undefined);
        }
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [refresh, start, startOnMount]);

  const handleMinimize = useCallback(async () => {
    setPending(true);
    try {
      if (state.status === "ready") {
        await onDone?.();
        return;
      }
      if (state.status === "idle" || state.status === "skipped" || state.status === "error") {
        await start();
      }
      await onMinimize?.();
    } finally {
      setPending(false);
    }
  }, [onDone, onMinimize, start, state.status]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 1600);
    return () => window.clearInterval(timer);
  }, [active, refresh]);

  const statusLabel = useMemo(() => {
    if (state.status === "ready") return "Ready";
    if (state.status === "error") return "Needs attention";
    if (state.status === "skipped") return "Later";
    if (state.status === "running") return "Installing";
    return "Ready";
  }, [state.status]);

  if (variant === "compact") {
    if (!visibleCompact) {
      return null;
    }
    return (
      <div className={`setup-prep-compact setup-prep-compact-${state.status}`} role="status" aria-live="polite">
        <div className="setup-prep-compact-copy">
          <span>{statusLabel}</span>
          <strong>{state.message}</strong>
        </div>
        <div className="setup-prep-mini-track" aria-label={`Preparation ${progress}% complete`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <button className="btn btn-ghost" type="button" onClick={() => setHidden(true)}>
          Hide
        </button>
      </div>
    );
  }

  return (
    <div className="setup-prep-screen" aria-busy={active || pending}>
      <div className="setup-prep-center">
        <p className="setup-onboarding-kicker">{statusLabel}</p>
        <h2>Getting OdogwuHQ ready</h2>
        <p>{state.message}</p>

        <div className="setup-prep-progress" aria-label={`Preparation ${progress}% complete`}>
          <span style={{ width: `${progress}%` }} />
        </div>

        <p className="setup-prep-detail">{state.detail}</p>

        <div className="wizard-actions">
          <button className="btn btn-ghost setup-secondary-action" type="button" onClick={skip} disabled={pending}>
            Do this later
          </button>
          <button
            className="btn btn-primary setup-primary-action"
            type="button"
            disabled={pending}
            onClick={() => {
              void handleMinimize();
            }}
          >
            {state.status === "ready" ? "Continue" : "Minimize and proceed"}
          </button>
        </div>
      </div>
    </div>
  );
}
