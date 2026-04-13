import { DashboardPage } from "@/components/dashboard-page";
import { LiveStatus } from "@/components/live-status";

export default async function StatusPage() {
  return (
    <DashboardPage title="Status" subtitle="Review pending drafts and posted status updates in one stream.">
      <LiveStatus />
    </DashboardPage>
  );
}
