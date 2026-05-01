"use client";

import { useTenantScopeArgs } from "@/components/tenant-scope-provider";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
import { useEffect } from "react";

export type ProviderFilterValue = "all" | "whatsapp" | "instagram" | "imessage" | "telegram";

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
  const imessageSetup = useQuery(api.system.setupStatus, { ...tenantScope, provider: "imessage" }) as
    | {
        status?: string;
        hasAuth?: boolean;
        listenerActive?: boolean;
      }
    | null
    | undefined;
  const imessageConnected = Boolean(
    imessageSetup?.hasAuth || imessageSetup?.listenerActive || imessageSetup?.status === "connected",
  );
  const telegramSetup = useQuery(api.system.setupStatus, { ...tenantScope, provider: "telegram" }) as
    | {
        status?: string;
        hasAuth?: boolean;
        listenerActive?: boolean;
      }
    | null
    | undefined;
  const telegramConnected = Boolean(
    telegramSetup?.hasAuth || telegramSetup?.listenerActive || telegramSetup?.status === "connected",
  );

  useEffect(() => {
    if (
      (!instagramConnected && instagramSetup !== undefined && value === "instagram") ||
      (!imessageConnected && imessageSetup !== undefined && value === "imessage") ||
      (!telegramConnected && telegramSetup !== undefined && value === "telegram")
    ) {
      onChange("all");
    }
  }, [
    imessageConnected,
    imessageSetup,
    instagramConnected,
    instagramSetup,
    onChange,
    telegramConnected,
    telegramSetup,
    value,
  ]);

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
      {imessageConnected ? (
        <button
          type="button"
          role="tab"
          aria-selected={value === "imessage"}
          className={`btn ${value === "imessage" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => onChange("imessage")}
        >
          iMessage
        </button>
      ) : null}
      {telegramConnected ? (
        <button
          type="button"
          role="tab"
          aria-selected={value === "telegram"}
          className={`btn ${value === "telegram" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => onChange("telegram")}
        >
          Telegram
        </button>
      ) : null}
    </div>
  );
}
