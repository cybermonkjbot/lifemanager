import { DashboardPage } from "@/components/dashboard-page";
import { LiveQueue } from "@/components/live-queue";

export default async function QueuePage() {
  return (
    <DashboardPage title="Queue" subtitle="Review pending replies, follow-up confirmations, todos, and guardrails.">
      <LiveQueue />
    </DashboardPage>
  );
}
