import Link from "next/link";

export default function NotFound() {
  return (
    <div className="app-state-screen">
      <section className="app-state-card">
        <h1>Page not found</h1>
        <p>We could not find that page.</p>
        <div className="queue-actions">
          <Link className="btn btn-primary" href="/">
            Go Home
          </Link>
        </div>
      </section>
    </div>
  );
}
