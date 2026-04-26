import { DashboardPage } from "@/components/dashboard-page";
import { LiveMedia } from "@/components/live-media";

export default async function MediaPage() {
  return (
    <DashboardPage title="Media" subtitle="Browse captured files with source-thread context.">
      <LiveMedia />
    </DashboardPage>
  );
}
