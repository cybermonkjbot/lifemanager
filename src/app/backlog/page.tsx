import { DashboardPage } from "@/components/dashboard-page";
import { LiveBacklog } from "@/components/live-backlog";

export default async function BacklogPage() {
  return (
    <DashboardPage
      title="Backlog"
      subtitle="Review unread threads, set priority, and draft reconnect openers."
      hideViewHeader
    >
      <LiveBacklog />
    </DashboardPage>
  );
}
