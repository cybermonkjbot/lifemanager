import { LoadingIndicator } from "@/components/loading-state";

export default function Loading() {
  return (
    <main className="page-loading-shell" aria-busy="true">
      <LoadingIndicator label="Loading page..." />
    </main>
  );
}
