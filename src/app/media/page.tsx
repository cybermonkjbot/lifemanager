import { DashboardPage } from "@/components/dashboard-page";
import { LiveMedia } from "@/components/live-media";

export default async function MediaPage() {
  return (
    <DashboardPage title="Media" subtitle="Unified dashboard for stickers, images, video, audio, and documents across conversation threads.">
      <LiveMedia />
    </DashboardPage>
  );
}
