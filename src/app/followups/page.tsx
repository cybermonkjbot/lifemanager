import { DashboardPage } from "@/components/dashboard-page";
import { LiveFollowups } from "@/components/live-followups";

export default async function FollowupsPage() {
  return (
    <DashboardPage title="Follow-ups" subtitle="Confirm, reschedule, or dismiss reminders extracted from conversations.">
      <LiveFollowups />
    </DashboardPage>
  );
}
