"use client";

import { useEffect } from "react";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="app-state-screen">
      <section className="app-state-card">
        <h1>Something went wrong</h1>
        <p>This page hit an unexpected error. Try again.</p>
        <div className="queue-actions">
          <button type="button" className="btn btn-primary" onClick={() => unstable_retry()}>
            Retry
          </button>
        </div>
      </section>
    </div>
  );
}
