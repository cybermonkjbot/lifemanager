"use client";

import type { Id } from "../../convex/_generated/dataModel";
import { createContext, useContext, useMemo, type ReactNode } from "react";

type TenantScopeContextValue = {
  tenantId?: Id<"tenantAccounts">;
};

const TenantScopeContext = createContext<TenantScopeContextValue>({});

export function TenantScopeProvider({ tenantId, children }: { tenantId?: string; children: ReactNode }) {
  const value = useMemo<TenantScopeContextValue>(
    () => (tenantId ? { tenantId: tenantId as Id<"tenantAccounts"> } : {}),
    [tenantId],
  );

  return <TenantScopeContext.Provider value={value}>{children}</TenantScopeContext.Provider>;
}

export function useTenantScopeArgs() {
  return useContext(TenantScopeContext);
}
