import { DashboardPage } from "@/components/dashboard-page";
import { LiveFollowups } from "@/components/live-followups";

export default async function FollowupsPage() {
  return (
    <DashboardPage title="Follow-ups" subtitle="Timeline-first commitment tracking with quick confirm, snooze, and dismiss.">
      <LiveFollowups />
    </DashboardPage>
  );
}
