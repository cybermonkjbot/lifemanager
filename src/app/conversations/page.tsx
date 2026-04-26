import { DashboardPage } from "@/components/dashboard-page";
import { LiveConversations } from "@/components/live-conversations";
import { WorkspaceHeaderControls } from "@/components/workspace-header-controls";

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ threadId?: string }>;
}) {
  const params = await searchParams;

  return (
    <DashboardPage title="" subtitle="" hideViewHeader hideShellChrome>
      <div className="conversations-page-controls">
        <WorkspaceHeaderControls className="view-header-actions conversations-header-actions" showMenu />
      </div>
      <LiveConversations initialThreadId={params.threadId} />
    </DashboardPage>
  );
}
