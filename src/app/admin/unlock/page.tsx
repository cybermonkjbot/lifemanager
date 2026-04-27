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
  const hasError = getSingleValue(params.error) === "1";

  return (
    <main className="admin-unlock-shell">
      <div className="admin-console-grid" aria-hidden="true" />
      <section className="admin-unlock-panel">
        <div className="admin-unlock-brief">
          <h1>Admin Access</h1>
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

          <button className="btn btn-primary admin-primary-action" type="submit">
            Unlock console
          </button>
        </form>
      </section>
    </main>
  );
}
