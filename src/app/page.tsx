import { DashboardPage } from "@/components/dashboard-page";
import { HomeScreen } from "@/components/home-screen";

export default async function HomePage() {
  return (
    <DashboardPage
      title="Home"
      subtitle="Start with queue triage, conversation tuning, and daily follow-through."
      hideViewHeader
    >
      <HomeScreen />
    </DashboardPage>
  );
}
