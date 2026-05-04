"use client";

import { useRuntimeStatus } from "@/components/runtime-status-provider";
import { useEffect } from "react";

export type ProviderFilterValue = "all" | "whatsapp" | "instagram";

type ProviderFilterProps = {
  value: ProviderFilterValue;
  onChange: (value: ProviderFilterValue) => void;
  label?: string;
  allLabel?: string;
};

export function ProviderFilter({
  value,
  onChange,
  label = "Provider filter",
  allLabel = "All",
}: ProviderFilterProps) {
  const runtimeStatus = useRuntimeStatus();
  const instagramConnected = runtimeStatus?.instagramConnected === true;

  useEffect(() => {
    if (runtimeStatus !== undefined && runtimeStatus !== null && !instagramConnected && value === "instagram") {
      onChange("all");
    }
  }, [instagramConnected, onChange, runtimeStatus, value]);

  return (
    <div className="queue-focus-tabs" role="tablist" aria-label={label}>
      <button
        type="button"
        role="tab"
        aria-selected={value === "all"}
        className={`btn ${value === "all" ? "btn-primary" : "btn-ghost"}`}
        onClick={() => onChange("all")}
      >
        {allLabel}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "whatsapp"}
        className={`btn ${value === "whatsapp" ? "btn-primary" : "btn-ghost"}`}
        onClick={() => onChange("whatsapp")}
      >
        WhatsApp
      </button>
      {instagramConnected ? (
        <button
          type="button"
          role="tab"
          aria-selected={value === "instagram"}
          className={`btn ${value === "instagram" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => onChange("instagram")}
        >
          Instagram
        </button>
      ) : null}
    </div>
  );
}
