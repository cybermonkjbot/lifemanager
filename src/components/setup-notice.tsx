export function SetupNotice({ error }: { error: string | null }) {
  return (
    <section className="setup-notice">
      <h3>Live updates unavailable</h3>
      <p>Open Setup to connect the backend.</p>
      {error ? <p className="setup-error">Last error: {error}</p> : null}
    </section>
  );
}
