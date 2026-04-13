import { DashboardPage } from "@/components/dashboard-page";
import { LiveSelfImprovement } from "@/components/live-self-improvement";

export default async function SelfImprovementPage() {
  return (
    <DashboardPage
      title="Self Improvement"
      subtitle="Review manual and scheduled improvement runs with outcomes, reports, and errors."
    >
      <LiveSelfImprovement />
    </DashboardPage>
  );
}
