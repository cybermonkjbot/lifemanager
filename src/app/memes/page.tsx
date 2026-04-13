import { DashboardPage } from "@/components/dashboard-page";
import { LiveMemes } from "@/components/live-memes";

export default async function MemesPage() {
  return (
    <DashboardPage title="Memes" subtitle="Generate memes and review outputs in one workspace.">
      <LiveMemes />
    </DashboardPage>
  );
}
