import { DashboardPage } from "@/components/dashboard-page";
import { LiveBacklog } from "@/components/live-backlog";

export default async function BacklogPage() {
  return (
    <DashboardPage title="Unread Backlog" subtitle="Reach back out to unresolved messages, rank by importance, and restart stale threads.">
      <LiveBacklog />
    </DashboardPage>
  );
}
