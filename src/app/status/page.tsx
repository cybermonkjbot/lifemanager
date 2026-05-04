import { DashboardPage } from "@/components/dashboard-page";
import { LiveStatus } from "@/components/live-status";

export default async function StatusPage() {
  return (
    <DashboardPage
      title="Status"
      subtitle="Approve status drafts and inspect posted updates in one stream."
      businessTitle="Business Status"
      businessSubtitle="Approve offer updates, customer-facing posts, and posted business status activity."
    >
      <LiveStatus />
    </DashboardPage>
  );
}
