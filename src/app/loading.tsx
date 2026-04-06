export default function Loading() {
  return (
    <div className="app-state-screen" role="status" aria-live="polite">
      <section className="app-state-card">
        <h1>Loading workspace…</h1>
        <p>Preparing your latest queue, conversations, and runtime controls.</p>
      </section>
    </div>
  );
}
