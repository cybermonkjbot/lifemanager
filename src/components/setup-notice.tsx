export function SetupNotice({ error }: { error: string | null }) {
  return (
    <section className="setup-notice">
      <h3>Convex Not Ready Yet</h3>
      <p>
        Set <code>CONVEX_URL</code> (or <code>NEXT_PUBLIC_CONVEX_URL</code>) and run <code>bunx convex dev</code> to
        connect the dashboard.
      </p>
      {error ? <p className="setup-error">Last error: {error}</p> : null}
    </section>
  );
}
