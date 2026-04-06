import { DashboardShell } from "@/components/dashboard-shell";
import { LiveSystem } from "@/components/live-system";

export default async function SystemPage() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL || "";

  return (
    <DashboardShell
      title="System"
      subtitle="Watch runtime health, provider traces, and message lifecycle events."
      convexUrl={convexUrl}
      showLogWatcher
    >
      <LiveSystem />
    </DashboardShell>
  );
}
