import { DashboardPage } from "@/components/dashboard-page";
import { LiveStatus } from "@/components/live-status";

export default async function StatusPage() {
  return (
    <DashboardPage title="Status" subtitle="Track your status timeline and review status drafts in one place.">
      <LiveStatus />
    </DashboardPage>
  );
}

