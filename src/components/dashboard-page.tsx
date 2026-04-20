import { DashboardShell } from "@/components/dashboard-shell";
import { getConvexUrl } from "@/lib/runtime-env";
import type { ReactNode } from "react";

type DashboardPageProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  showLogWatcher?: boolean;
  hideViewHeader?: boolean;
  hideShellChrome?: boolean;
};

export async function DashboardPage({
  title,
  subtitle,
  children,
  showLogWatcher = false,
  hideViewHeader = false,
  hideShellChrome = false,
}: DashboardPageProps) {
  return (
    <DashboardShell
      title={title}
      subtitle={subtitle}
      convexUrl={getConvexUrl()}
      showLogWatcher={showLogWatcher}
      hideViewHeader={hideViewHeader}
      hideShellChrome={hideShellChrome}
    >
      {children}
    </DashboardShell>
  );
}
