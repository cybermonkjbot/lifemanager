import { DashboardPage } from "@/components/dashboard-page";
import { LiveSystem } from "@/components/live-system";

export default async function SystemPage() {
  return (
    <DashboardPage title="System" subtitle="Monitor health, provider attempts, alerts, and event flow." showLogWatcher>
      <LiveSystem />
    </DashboardPage>
  );
}
