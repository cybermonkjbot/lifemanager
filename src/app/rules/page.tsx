import { DashboardPage } from "@/components/dashboard-page";
import { LiveRules } from "@/components/live-rules";

export default async function RulesPage() {
  return (
    <DashboardPage title="Rules" subtitle="Set ignore lists, boundaries, and send constraints.">
      <LiveRules />
    </DashboardPage>
  );
}
