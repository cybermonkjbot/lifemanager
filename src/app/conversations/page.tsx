import { DashboardShell } from "@/components/dashboard-shell";
import { LiveConversations } from "@/components/live-conversations";

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ threadId?: string }>;
}) {
  const params = await searchParams;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL || "";

  return (
    <DashboardShell
      title="Conversations"
      subtitle="Read full context and inspect generated replies."
      convexUrl={convexUrl}
    >
      <LiveConversations initialThreadId={params.threadId} />
    </DashboardShell>
  );
}
