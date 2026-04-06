import { DashboardShell } from "@/components/dashboard-shell";
import { LiveQueue } from "@/components/live-queue";

export default async function QueuePage() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL || "";

  return (
    <DashboardShell
      title="Action Queue"
      subtitle="Process replies, confirmations, TODOs, and safety flags fast."
      convexUrl={convexUrl}
    >
      <LiveQueue />
    </DashboardShell>
  );
}
