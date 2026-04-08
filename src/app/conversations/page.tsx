import { DashboardPage } from "@/components/dashboard-page";
import { LiveConversations } from "@/components/live-conversations";

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ threadId?: string }>;
}) {
  const params = await searchParams;

  return (
    <DashboardPage title="Conversations" subtitle="Read full context and inspect generated replies.">
      <LiveConversations initialThreadId={params.threadId} />
    </DashboardPage>
  );
}
