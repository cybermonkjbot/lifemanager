import { DashboardPage } from "@/components/dashboard-page";
import { LiveMemes } from "@/components/live-memes";

export default async function MemesPage() {
  return (
    <DashboardPage title="Memes" subtitle="Generate meme assets, preview outputs, and keep sending under review.">
      <LiveMemes />
    </DashboardPage>
  );
}
