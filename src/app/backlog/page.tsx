import { DashboardPage } from "@/components/dashboard-page";
import { LiveBacklog } from "@/components/live-backlog";

export default async function BacklogPage() {
  return (
    <DashboardPage
      title="Catch Up"
      subtitle="Pick up conversations that still need a reply or a gentle reconnect."
      hideViewHeader
    >
      <LiveBacklog />
    </DashboardPage>
  );
}
