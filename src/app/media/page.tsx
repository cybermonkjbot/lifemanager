import { DashboardPage } from "@/components/dashboard-page";
import { LiveMedia } from "@/components/live-media";

export default async function MediaPage() {
  return (
    <DashboardPage
      title="Media"
      subtitle="Browse captured files with source-thread context."
      businessTitle="Customer Media"
      businessSubtitle="Browse customer files, product media, receipts, and source-thread context."
    >
      <LiveMedia />
    </DashboardPage>
  );
}
