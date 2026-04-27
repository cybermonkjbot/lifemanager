"use client";

import { useState } from "react";
import type { AdminMasqueradeSession } from "@/lib/admin-masquerade";

type AdminMasqueradeBannerProps = {
  session: AdminMasqueradeSession;
};

export function AdminMasqueradeBanner({ session }: AdminMasqueradeBannerProps) {
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");

  const stopMasquerade = async () => {
    setStopping(true);
    setError("");
    try {
      const response = await fetch("/api/admin/masquerade", { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Failed to stop masquerade.");
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop masquerade.");
      setStopping(false);
    }
  };

  return (
    <section className="admin-masquerade-banner" role="status" aria-live="polite">
      <div>
        <span>Admin masquerade active</span>
        <strong>{session.tenantEmail}</strong>
        <em>Admin: {session.adminEmail}</em>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <button className="btn btn-primary" type="button" disabled={stopping} onClick={() => void stopMasquerade()}>
        {stopping ? "Stopping..." : "Stop masquerading"}
      </button>
    </section>
  );
}
