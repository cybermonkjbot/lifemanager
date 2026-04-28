import { AdminMasqueradeBanner } from "@/components/admin-masquerade-banner";
import { AdminConsoleShell } from "@/components/admin-console-shell";
import { requireAdminPageAccess } from "@/lib/admin-auth";
import { getAdminMasqueradeCookieName, readAdminMasqueradeToken } from "@/lib/admin-masquerade";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import { getManagedSecretEnvFallback, MANAGED_SECRET_DEFINITIONS } from "@/lib/managed-secret-definitions";
import { getConvexAdminSecret } from "@/lib/managed-secret-crypto";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

type ManagedSecretRow = {
  key: string;
  valuePreview: string;
  updatedAt: number;
  updatedBy: string;
};

function integrationGroup(key: string) {
  if (key.startsWith("azure.")) {
    return "AI";
  }
  if (key.startsWith("flutterwave.") || key.startsWith("billing.")) {
    return "Billing";
  }
  if (key.startsWith("resend.")) {
    return "Email";
  }
  return "Runtime";
}

export default async function AdminIntegrationsPage() {
  await requireAdminPageAccess("/admin/integrations");
  const cookieStore = await cookies();
  const masqueradeSession = readAdminMasqueradeToken(cookieStore.get(getAdminMasqueradeCookieName())?.value);
  const rows = (await createConvexClient().query(convexRefs.adminSecretsList, {
    adminSecret: getConvexAdminSecret(),
  })) as ManagedSecretRow[];
  const stored = new Map(rows.map((row) => [row.key, row]));
  const statuses = MANAGED_SECRET_DEFINITIONS.map((definition) => {
    const row = stored.get(definition.key);
    const envFallback = Boolean(getManagedSecretEnvFallback(definition.key));
    return {
      ...definition,
      group: integrationGroup(definition.key),
      configured: Boolean(row || envFallback),
      source: row ? "managed" : envFallback ? "env" : "missing",
      preview: row?.valuePreview || (envFallback ? "env fallback" : ""),
    };
  });
  const configured = statuses.filter((status) => status.configured).length;

  return (
    <AdminConsoleShell>
      {masqueradeSession ? <AdminMasqueradeBanner session={masqueradeSession} /> : null}
      <header className="admin-console-header">
        <div>
          <p className="admin-kicker">Provider Health</p>
          <h1>Integrations</h1>
          <p>Check which provider settings are configured through managed secrets or environment fallbacks.</p>
        </div>
      </header>
      <section className="admin-config-stack">
        <div className="admin-stat-grid">
          <div><span>Definitions</span><strong>{statuses.length}</strong></div>
          <div><span>Configured</span><strong>{configured}</strong></div>
          <div><span>Missing</span><strong>{statuses.length - configured}</strong></div>
        </div>
        <section className="admin-data-panel">
          <div className="admin-table-toolbar">
            <div>
              <span>Readiness Matrix</span>
              <strong>{configured} of {statuses.length} configured</strong>
            </div>
          </div>
          <div className="admin-data-head admin-integration-head">
            <span>Integration</span>
            <span>Group</span>
            <span>Status</span>
            <span>Source</span>
          </div>
          <div className="admin-data-list">
            {statuses.map((status) => (
              <article className="admin-data-row admin-integration-row" key={status.key}>
                <div><strong>{status.label}</strong><span>{status.key}</span></div>
                <div><strong>{status.group}</strong><span>{status.secret ? "secret" : "setting"}</span></div>
                <div><strong>{status.configured ? "Configured" : "Missing"}</strong><span>{status.description}</span></div>
                <div><strong>{status.source}</strong><span>{status.preview}</span></div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </AdminConsoleShell>
  );
}
