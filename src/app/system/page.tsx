import { DashboardPage } from "@/components/dashboard-page";
import { LiveSystem } from "@/components/live-system";

export default async function SystemPage() {
  return (
    <DashboardPage title="System" subtitle="Monitor runtime health, provider traces, and event flow." showLogWatcher>
      <LiveSystem />
    </DashboardPage>
  );
}
