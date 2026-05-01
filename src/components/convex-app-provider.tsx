"use client";

import { ConvexProvider, ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { ReactNode, useCallback, useMemo } from "react";

type ConvexAppProviderProps = {
  convexUrl?: string;
  authEnabled?: boolean;
  children: ReactNode;
};

function useOdogwuConvexAuth() {
  const fetchAccessToken = useCallback(async () => {
    const response = await fetch("/api/auth/convex-token", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json().catch(() => null)) as { token?: string } | null;
    return data?.token || null;
  }, []);

  return useMemo(
    () => ({
      isLoading: false,
      isAuthenticated: true,
      fetchAccessToken,
    }),
    [fetchAccessToken],
  );
}

export function ConvexAppProvider({ convexUrl, authEnabled = false, children }: ConvexAppProviderProps) {
  const client = useMemo(() => {
    if (!convexUrl) {
      return null;
    }

    return new ConvexReactClient(convexUrl);
  }, [convexUrl]);

  if (!client) {
    return <>{children}</>;
  }

  if (authEnabled) {
    return (
      <ConvexProviderWithAuth client={client} useAuth={useOdogwuConvexAuth}>
        {children}
      </ConvexProviderWithAuth>
    );
  }

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
