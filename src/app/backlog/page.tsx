import { DashboardPage } from "@/components/dashboard-page";
import { LiveBacklog } from "@/components/live-backlog";

export default async function BacklogPage() {
  return (
    <DashboardPage
      title="Catch Up"
      subtitle="Pick up conversations that still need a reply or a gentle reconnect."
      businessTitle="Lead Catch Up"
      businessSubtitle="Pick up customers and leads waiting on price, payment, delivery, or a clear next step."
      hideViewHeader
    >
      <LiveBacklog />
    </DashboardPage>
  );
}
