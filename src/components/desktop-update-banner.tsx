"use client";

import { useEffect, useState } from "react";

type DesktopUpdateStatus = "idle" | "checking" | "downloading" | "ready" | "restarting" | "error";

type DesktopUpdateState = {
  status: DesktopUpdateStatus;
  version?: string;
  error?: string;
  progress?: number | null;
};

type DesktopUpdateApi = {
  getState: () => Promise<DesktopUpdateState>;
  restartAndInstall: () => Promise<{ ok: boolean; error?: string }>;
  onStateChange: (callback: (state: DesktopUpdateState) => void) => () => void;
};

declare global {
  interface Window {
    odogwuDesktopUpdates?: DesktopUpdateApi;
  }
}

function getUpdateCopy(state: DesktopUpdateState) {
  if (state.status === "downloading") {
    return {
      title: state.version ? `Downloading Odogwu HQ ${state.version}` : "Downloading an update",
      body: "The app will let you restart as soon as the update is ready.",
    };
  }

  if (state.status === "ready") {
    return {
      title: state.version ? `Odogwu HQ ${state.version} is ready` : "An update is ready",
      body: "Restart the app to finish installing it.",
    };
  }

  if (state.status === "restarting") {
    return {
      title: "Restarting Odogwu HQ",
      body: "Closing the local runtime and installing the update.",
    };
  }

  return null;
}

export function DesktopUpdateBanner() {
  const [state, setState] = useState<DesktopUpdateState>({ status: "idle" });
  const [restartError, setRestartError] = useState("");

  useEffect(() => {
    const updates = window.odogwuDesktopUpdates;
    if (!updates) {
      return;
    }

    let mounted = true;
    updates.getState()
      .then((nextState) => {
        if (mounted) {
          setState(nextState);
        }
      })
      .catch(() => {});

    const unsubscribe = updates.onStateChange((nextState) => {
      setState(nextState);
      setRestartError("");
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const copy = getUpdateCopy(state);
  if (!copy) {
    return null;
  }
  const progress = Number.isFinite(Number(state.progress)) ? Math.max(0, Math.min(100, Math.round(Number(state.progress)))) : null;

  const restart = async () => {
    setRestartError("");
    const result = await window.odogwuDesktopUpdates?.restartAndInstall();
    if (!result?.ok) {
      setRestartError(result?.error || "Could not restart for the update.");
    }
  };

  return (
    <section className="desktop-update-banner" role="status" aria-live="polite">
      <div>
        <span>{copy.title}</span>
        <p>{copy.body}</p>
        {state.status === "downloading" || state.status === "restarting" ? (
          <div
            className={`install-progress-track ${progress === null ? "install-progress-track-indeterminate" : ""}`}
            role="progressbar"
            aria-label="Desktop update installation progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress ?? undefined}
          >
            <span style={progress === null ? undefined : { width: `${progress}%` }} />
          </div>
        ) : null}
        {restartError ? <em>{restartError}</em> : null}
      </div>
      {state.status === "ready" ? (
        <button className="btn btn-primary" type="button" onClick={restart}>
          Restart app
        </button>
      ) : null}
    </section>
  );
}
