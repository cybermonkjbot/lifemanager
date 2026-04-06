import { DashboardShell } from "@/components/dashboard-shell";
import { LiveBacklog } from "@/components/live-backlog";

export default async function BacklogPage() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL || "";

  return (
    <DashboardShell
      title="Unread Backlog"
      subtitle="Reach back out to unresolved messages, rank by importance, and restart stale threads."
      convexUrl={convexUrl}
    >
      <LiveBacklog />
    </DashboardShell>
  );
}
