export function SetupNotice({ error }: { error: string | null }) {
  return (
    <section className="setup-notice">
      <h3>Finish setup to load live data</h3>
      <p>
        Set <code>CONVEX_URL</code> (or <code>NEXT_PUBLIC_CONVEX_URL</code>), then run <code>bunx convex dev</code>{" "}
        to connect this dashboard.
      </p>
      {error ? <p className="setup-error">Last error: {error}</p> : null}
    </section>
  );
}
