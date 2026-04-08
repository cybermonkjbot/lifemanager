import { DashboardPage } from "@/components/dashboard-page";
import { LiveBacklog } from "@/components/live-backlog";

export default async function BacklogPage() {
  return (
    <DashboardPage title="Unread Backlog" subtitle="Triage unresolved threads, rank priority, and draft reconnect openers.">
      <LiveBacklog />
    </DashboardPage>
  );
}
