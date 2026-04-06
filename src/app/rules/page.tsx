import { DashboardShell } from "@/components/dashboard-shell";
import { LiveRules } from "@/components/live-rules";

export default async function RulesPage() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL || "";

  return (
    <DashboardShell
      title="Rules"
      subtitle="Control ignores, initiation boundaries, and safety defaults."
      convexUrl={convexUrl}
    >
      <LiveRules />
    </DashboardShell>
  );
}
