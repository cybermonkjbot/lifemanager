import { DashboardPage } from "@/components/dashboard-page";
import { HomeScreen } from "@/components/home-screen";

export default async function HomePage() {
  return (
    <DashboardPage
      title="Home"
      subtitle="Ask for a read on chats, drafts, follow-ups, and system state."
      hideViewHeader
    >
      <HomeScreen />
    </DashboardPage>
  );
}
