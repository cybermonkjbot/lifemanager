import { DashboardPage } from "@/components/dashboard-page";
import { LiveBacklog } from "@/components/live-backlog";

export default async function BacklogPage() {
  return (
    <DashboardPage
      title="Backlog"
      subtitle="Triage stale or unresolved threads before reconnecting."
      hideViewHeader
    >
      <LiveBacklog />
    </DashboardPage>
  );
}
