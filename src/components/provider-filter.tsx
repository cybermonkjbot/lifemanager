"use client";

import { useRuntimeStatus } from "@/components/runtime-status-provider";
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
  const runtimeStatus = useRuntimeStatus();
  const instagramConnected = runtimeStatus?.instagramConnected === true;
  const imessageConnected = runtimeStatus?.imessageConnected === true;
  const telegramConnected = runtimeStatus?.telegramConnected === true;

  useEffect(() => {
    if (
      runtimeStatus !== undefined &&
      runtimeStatus !== null &&
      ((!instagramConnected && value === "instagram") ||
        (!imessageConnected && value === "imessage") ||
        (!telegramConnected && value === "telegram"))
    ) {
      onChange("all");
    }
  }, [imessageConnected, instagramConnected, onChange, runtimeStatus, telegramConnected, value]);

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
