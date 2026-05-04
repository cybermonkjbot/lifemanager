"use client";

import { useTenantScopeArgs } from "@/components/tenant-scope-provider";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
import { createContext, useContext, type ReactNode } from "react";

type ProviderSetupSnapshot = {
  status?: string;
  message?: string;
  hasAuth?: boolean;
  hasConnectedBefore?: boolean;
  listenerActive?: boolean;
  listenerMessage?: string;
} | null;

export type RuntimeStatusSnapshot = {
  autonomyPaused: boolean;
  billing: {
    blocked: boolean;
    status?: string;
    reason?: string;
  };
  providers: {
    whatsapp: ProviderSetupSnapshot;
    instagram: ProviderSetupSnapshot;
    imessage: ProviderSetupSnapshot;
    telegram: ProviderSetupSnapshot;
  };
  anyWorkerConnected: boolean;
  instagramConnected: boolean;
  imessageConnected: boolean;
  telegramConnected: boolean;
};

const RuntimeStatusContext = createContext<RuntimeStatusSnapshot | null | undefined>(null);

export function RuntimeStatusProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const tenantScope = useTenantScopeArgs();
  const value = useQuery(api.system.runtimeStatus, enabled ? tenantScope : "skip") as RuntimeStatusSnapshot | undefined;

  return <RuntimeStatusContext.Provider value={enabled ? value : null}>{children}</RuntimeStatusContext.Provider>;
}

export function useRuntimeStatus() {
  return useContext(RuntimeStatusContext);
}
