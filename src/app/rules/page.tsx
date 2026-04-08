import { DashboardPage } from "@/components/dashboard-page";
import { LiveRules } from "@/components/live-rules";

export default async function RulesPage() {
  return (
    <DashboardPage title="Rules" subtitle="Control ignores, initiation boundaries, and safety defaults.">
      <LiveRules />
    </DashboardPage>
  );
}
