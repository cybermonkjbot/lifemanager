"use client";

import { useTenantScopeArgs } from "@/components/tenant-scope-provider";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
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
  const tenantScope = useTenantScopeArgs();
  const instagramSetup = useQuery(api.system.setupStatus, { ...tenantScope, provider: "instagram" }) as
    | {
        status?: string;
        hasAuth?: boolean;
        listenerActive?: boolean;
      }
    | null
    | undefined;
  const instagramConnected = Boolean(
    instagramSetup?.hasAuth || instagramSetup?.listenerActive || instagramSetup?.status === "connected",
  );

  useEffect(() => {
    if (!instagramConnected && value === "instagram") {
      onChange("all");
    }
  }, [instagramConnected, onChange, value]);

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
