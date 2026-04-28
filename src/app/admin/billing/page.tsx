import { AdminMasqueradeBanner } from "@/components/admin-masquerade-banner";
import { AdminConsoleShell } from "@/components/admin-console-shell";
import { requireAdminPageAccess } from "@/lib/admin-auth";
import { getAdminMasqueradeCookieName, readAdminMasqueradeToken } from "@/lib/admin-masquerade";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import { getConvexAdminSecret } from "@/lib/managed-secret-crypto";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

type BillingOps = {
  expiredTrials: number;
  expiredSubscriptions: number;
  statusCounts: Record<string, number>;
  recentEvents: Array<{
    _id: string;
    provider: string;
    eventType: string;
    status?: string;
    txRef?: string;
    detail: string;
    createdAt: number;
  }>;
};

function formatDate(value: number) {
  return new Date(value).toLocaleString();
}

export default async function AdminBillingPage() {
  await requireAdminPageAccess("/admin/billing");
  const cookieStore = await cookies();
  const masqueradeSession = readAdminMasqueradeToken(cookieStore.get(getAdminMasqueradeCookieName())?.value);
  const ops = (await createConvexClient().query(convexRefs.adminPlatformBillingOps, {
    adminSecret: getConvexAdminSecret(),
  })) as BillingOps;

  return (
    <AdminConsoleShell>
      {masqueradeSession ? <AdminMasqueradeBanner session={masqueradeSession} /> : null}
      <header className="admin-console-header">
        <div>
          <p className="admin-kicker">Billing Ops</p>
          <h1>Billing</h1>
          <p>Review expired access windows, subscription status counts, and the latest billing events.</p>
        </div>
      </header>
      <section className="admin-config-stack">
        <div className="admin-stat-grid">
          <div><span>Expired Trials</span><strong>{ops.expiredTrials}</strong></div>
          <div><span>Expired Subs</span><strong>{ops.expiredSubscriptions}</strong></div>
          {Object.entries(ops.statusCounts).slice(0, 4).map(([status, count]) => (
            <div key={status}><span>{status}</span><strong>{count}</strong></div>
          ))}
        </div>
        <section className="admin-data-panel">
          <div className="admin-table-toolbar">
            <div>
              <span>Event Feed</span>
              <strong>{ops.recentEvents.length} recent events</strong>
            </div>
          </div>
          <div className="admin-data-head admin-billing-event-head">
            <span>Event</span>
            <span>Status</span>
            <span>Reference</span>
            <span>Created</span>
          </div>
          <div className="admin-data-list">
            {ops.recentEvents.map((event) => (
              <article className="admin-data-row admin-billing-event-row" key={event._id}>
                <div><strong>{event.eventType}</strong><span>{event.provider}</span></div>
                <div><strong>{event.status || "n/a"}</strong><span>{event.detail.slice(0, 90)}</span></div>
                <div><strong>{event.txRef || "n/a"}</strong><span>transaction</span></div>
                <div><strong>{formatDate(event.createdAt)}</strong><span>received</span></div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </AdminConsoleShell>
  );
}
