import { DashboardPage } from "@/components/dashboard-page";
import { LiveSystem } from "@/components/live-system";

export default async function SystemPage() {
  return (
    <DashboardPage title="System" subtitle="Watch runtime health, provider traces, and message lifecycle events." showLogWatcher>
      <LiveSystem />
    </DashboardPage>
  );
}
