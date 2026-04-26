import { DashboardPage } from "@/components/dashboard-page";
import { LiveSelfImprovement } from "@/components/live-self-improvement";

export default async function SelfImprovementPage() {
  return (
    <DashboardPage
      title="Self Improvement"
      subtitle="Review local improvement runs, reports, and failures."
    >
      <LiveSelfImprovement />
    </DashboardPage>
  );
}
