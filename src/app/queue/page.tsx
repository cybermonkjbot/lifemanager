import { DashboardPage } from "@/components/dashboard-page";
import { LiveQueue } from "@/components/live-queue";

export default async function QueuePage() {
  return (
    <DashboardPage title="Queue" subtitle="Review drafts, follow-ups, tasks, and safety flags before anything moves.">
      <LiveQueue />
    </DashboardPage>
  );
}
