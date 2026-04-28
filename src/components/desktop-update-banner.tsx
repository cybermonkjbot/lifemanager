"use client";

import { useEffect, useState } from "react";

type DesktopUpdateStatus = "idle" | "checking" | "downloading" | "ready" | "restarting" | "error";

type DesktopUpdateState = {
  status: DesktopUpdateStatus;
  version?: string;
  error?: string;
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
