import { normalizeAdminNextPath } from "@/lib/admin-auth";
import { isElectronEnvironment } from "@/lib/runtime-env";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type AdminUnlockPageProps = {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

function getSingleValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminUnlockPage({ searchParams }: AdminUnlockPageProps) {
  if (isElectronEnvironment()) {
    notFound();
  }

  const params = searchParams ? await searchParams : {};
  const nextPath = normalizeAdminNextPath(getSingleValue(params.next));
  const error = getSingleValue(params.error);
  const hasError = error === "1";
  const backendUnavailable = error === "backend_unavailable";

  return (
    <main className="admin-unlock-shell">
      <div className="admin-console-grid" aria-hidden="true" />
      <section className="admin-unlock-panel">
        <div className="admin-unlock-brief">
          <p className="admin-kicker">Restricted Console</p>
          <h1>Admin Console</h1>
          <p>Sign in with an approved admin account to manage tenants, secrets, runtime health, and billing operations.</p>
        </div>

        <form className="admin-unlock-form" action="/api/admin/session" method="post">
          <input type="hidden" name="next" value={nextPath} />
          <label>
            <span>Admin email</span>
            <input name="email" type="email" placeholder="you@example.com" autoComplete="email" autoFocus />
          </label>
          <label>
            <span>Admin PIN</span>
            <input name="pin" type="password" placeholder="Enter admin PIN" autoComplete="current-password" />
          </label>

          {hasError ? <p className="admin-alert" role="alert">Admin email or PIN did not match.</p> : null}
          {backendUnavailable ? (
            <p className="admin-alert" role="alert">
              Admin login is temporarily unavailable because Convex could not be reached.
            </p>
          ) : null}

          <button className="btn btn-primary admin-primary-action" type="submit">
            Unlock console
          </button>
        </form>
      </section>
    </main>
  );
}
