"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

type CodeLabErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function CodeLabError({ error, reset }: CodeLabErrorProps) {
  const router = useRouter();

  useEffect(() => {
    console.error(error);
  }, [error]);

  const missingConvexFunction = error.message.includes("Could not find public function");

  return (
    <main className="code-lab-error-shell">
      <section className="code-lab-error-panel">
        <span>Code Lab</span>
        <h1>{missingConvexFunction ? "Convex is catching up" : "Code Lab could not load"}</h1>
        <p>
          {missingConvexFunction
            ? "The editor is installed locally, but the active Convex deployment does not have the Code Lab functions yet. Run `bunx convex dev --once`, then retry."
            : error.message || "Something interrupted the editor account."}
        </p>
        <div className="code-lab-error-actions">
          <button className="btn btn-primary" type="button" onClick={reset}>
            Retry
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => router.back()}>
            Back
          </button>
        </div>
      </section>
    </main>
  );
}
