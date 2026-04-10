type LoadingIndicatorProps = {
  label: string;
  inline?: boolean;
  className?: string;
};

type SkeletonListProps = {
  rows?: number;
  compact?: boolean;
  className?: string;
};

type LoadingBlockProps = {
  label: string;
  rows?: number;
  compact?: boolean;
  className?: string;
};

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function LoadingIndicator({ label, inline = false, className }: LoadingIndicatorProps) {
  return (
    <p className={joinClasses("loading-indicator", inline ? "loading-indicator-inline" : null, className)} role="status" aria-live="polite">
      <span className="loading-spinner" aria-hidden="true" />
      <span>{label}</span>
    </p>
  );
}

export function SkeletonList({ rows = 3, compact = false, className }: SkeletonListProps) {
  return (
    <div className={joinClasses("skeleton-list", className)} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={joinClasses("skeleton-card", compact ? "skeleton-card-compact" : null)}>
          <span className="skeleton-line skeleton-line-title" />
          <span className="skeleton-line skeleton-line-main" />
          <span className="skeleton-line skeleton-line-secondary" />
        </div>
      ))}
    </div>
  );
}

export function LoadingBlock({ label, rows = 3, compact = false, className }: LoadingBlockProps) {
  return (
    <div className={joinClasses("loading-block", className)}>
      <LoadingIndicator label={label} />
      <SkeletonList rows={rows} compact={compact} />
    </div>
  );
}
