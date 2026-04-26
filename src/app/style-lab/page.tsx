import { DashboardPage } from "@/components/dashboard-page";
import { LiveStyleLab } from "@/components/live-style-lab";

export default async function StyleLabPage() {
  return (
    <DashboardPage title="Style Lab" subtitle="Tune voice matching, persona packs, and rollback history.">
      <LiveStyleLab />
    </DashboardPage>
  );
}
