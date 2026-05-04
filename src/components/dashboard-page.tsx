import { DashboardShell } from "@/components/dashboard-shell";
import { requireAuthenticatedPageAccess } from "@/lib/instance-guard";
import { getLocalProductUse } from "@/lib/product-mode";
import { getConvexUrl } from "@/lib/runtime-env";
import type { ReactNode } from "react";

type DashboardPageProps = {
  title: string;
  subtitle: string;
  businessTitle?: string;
  businessSubtitle?: string;
  children: ReactNode;
  showLogWatcher?: boolean;
  logWatcherDefaultExpanded?: boolean;
  hideViewHeader?: boolean;
  hideShellChrome?: boolean;
};

export async function DashboardPage({
  title,
  subtitle,
  businessTitle,
  businessSubtitle,
  children,
  showLogWatcher = false,
  logWatcherDefaultExpanded = true,
  hideViewHeader = false,
  hideShellChrome = false,
}: DashboardPageProps) {
  await requireAuthenticatedPageAccess();
  const productUse = await getLocalProductUse();
  const resolvedTitle = productUse === "business" && businessTitle ? businessTitle : title;
  const resolvedSubtitle = productUse === "business" && businessSubtitle ? businessSubtitle : subtitle;

  return (
    <DashboardShell
      title={resolvedTitle}
      subtitle={resolvedSubtitle}
      convexUrl={getConvexUrl()}
      showLogWatcher={showLogWatcher}
      logWatcherDefaultExpanded={logWatcherDefaultExpanded}
      hideViewHeader={hideViewHeader}
      hideShellChrome={hideShellChrome}
    >
      {children}
    </DashboardShell>
  );
}
