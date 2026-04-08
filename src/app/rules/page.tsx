import { DashboardPage } from "@/components/dashboard-page";
import { LiveRules } from "@/components/live-rules";

export default async function RulesPage() {
  return (
    <DashboardPage title="Rules" subtitle="Manage ignore targets and runtime communication boundaries.">
      <LiveRules />
    </DashboardPage>
  );
}
