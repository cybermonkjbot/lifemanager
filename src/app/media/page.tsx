import { DashboardPage } from "@/components/dashboard-page";
import { LiveMedia } from "@/components/live-media";

export default async function MediaPage() {
  return (
    <DashboardPage title="Media" subtitle="Review captured assets and jump back to source conversations.">
      <LiveMedia />
    </DashboardPage>
  );
}
