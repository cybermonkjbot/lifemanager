import Link from "next/link";

export default function NotFound() {
  return (
    <div className="app-state-screen">
      <section className="app-state-card">
        <h1>Page not found</h1>
        <p>The route you requested does not exist in this dashboard.</p>
        <div className="queue-actions">
          <Link className="btn btn-primary" href="/">
            Go to Queue
          </Link>
        </div>
      </section>
    </div>
  );
}
