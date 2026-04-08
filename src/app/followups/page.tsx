import { DashboardShell } from "@/components/dashboard-shell";
import { LiveFollowups } from "@/components/live-followups";

export default async function FollowupsPage() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL || "";

  return (
    <DashboardShell
      title="Follow-ups"
      subtitle="Timeline-first commitment tracking with quick confirm, snooze, and dismiss."
      convexUrl={convexUrl}
    >
      <LiveFollowups />
    </DashboardShell>
  );
}
