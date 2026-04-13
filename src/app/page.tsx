import { DashboardPage } from "@/components/dashboard-page";
import { HomeScreen } from "@/components/home-screen";

export default async function HomePage() {
  return (
    <DashboardPage
      title="Home"
      subtitle="Start with queue triage, conversation review, and follow-up tracking."
      hideViewHeader
    >
      <HomeScreen />
    </DashboardPage>
  );
}
