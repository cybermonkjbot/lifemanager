import { DashboardShell } from "@/components/dashboard-shell";
import { getConvexUrl } from "@/lib/runtime-env";
import type { ReactNode } from "react";

type DashboardPageProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  showLogWatcher?: boolean;
};

export function DashboardPage({ title, subtitle, children, showLogWatcher = false }: DashboardPageProps) {
  return (
    <DashboardShell title={title} subtitle={subtitle} convexUrl={getConvexUrl()} showLogWatcher={showLogWatcher}>
      {children}
    </DashboardShell>
  );
}
