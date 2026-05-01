import { DashboardPage } from "@/components/dashboard-page";
import { LiveConversations } from "@/components/live-conversations";

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ threadId?: string }>;
}) {
  const params = await searchParams;

  return (
    <DashboardPage title="" subtitle="" hideViewHeader hideShellChrome>
      <LiveConversations initialThreadId={params.threadId} />
    </DashboardPage>
  );
}
