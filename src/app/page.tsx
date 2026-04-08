import { DashboardPage } from "@/components/dashboard-page";
import { LiveQueue } from "@/components/live-queue";

export default async function QueuePage() {
  return (
    <DashboardPage title="Action Queue" subtitle="Process replies, confirmations, TODOs, and safety flags fast.">
      <LiveQueue />
    </DashboardPage>
  );
}
