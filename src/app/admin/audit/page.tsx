import { AdminMasqueradeBanner } from "@/components/admin-masquerade-banner";
import { AdminConsoleShell } from "@/components/admin-console-shell";
import { requireAdminPageAccess } from "@/lib/admin-auth";
import { getAdminMasqueradeCookieName, readAdminMasqueradeToken } from "@/lib/admin-masquerade";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import { getConvexAdminSecret } from "@/lib/managed-secret-crypto";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

type AuditFeed = {
  events: Array<{
    id: string;
    source: string;
    eventType: string;
    detail: string;
    createdAt: number;
  }>;
};

function formatDate(value: number) {
  return new Date(value).toLocaleString();
}

export default async function AdminAuditPage() {
  await requireAdminPageAccess("/admin/audit");
  const cookieStore = await cookies();
  const masqueradeSession = readAdminMasqueradeToken(cookieStore.get(getAdminMasqueradeCookieName())?.value);
  const feed = (await createConvexClient().query(convexRefs.adminPlatformAuditFeed, {
    adminSecret: getConvexAdminSecret(),
  })) as AuditFeed;

  return (
    <AdminConsoleShell>
      {masqueradeSession ? <AdminMasqueradeBanner session={masqueradeSession} /> : null}
      <header className="admin-console-header">
        <div>
          <h1>Audit</h1>
        </div>
      </header>
      <section className="admin-data-panel">
        <div className="admin-data-head admin-audit-head">
          <span>Event</span>
          <span>Source</span>
          <span>Detail</span>
          <span>Created</span>
        </div>
        <div className="admin-data-list">
          {feed.events.map((event) => (
            <article className="admin-data-row admin-audit-row" key={event.id}>
              <div><strong>{event.eventType}</strong><span>audit event</span></div>
              <div><strong>{event.source}</strong><span>source</span></div>
              <div><strong>{event.detail.slice(0, 140)}</strong><span>detail</span></div>
              <div><strong>{formatDate(event.createdAt)}</strong><span>created</span></div>
            </article>
          ))}
        </div>
      </section>
    </AdminConsoleShell>
  );
}
