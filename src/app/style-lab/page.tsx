import { DashboardPage } from "@/components/dashboard-page";
import { LiveStyleLab } from "@/components/live-style-lab";

export default async function StyleLabPage() {
  return (
    <DashboardPage title="Style Lab" subtitle="Tune mimicry, inspect learned traits, and manage persona packs.">
      <LiveStyleLab />
    </DashboardPage>
  );
}
