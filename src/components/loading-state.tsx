type LoadingIndicatorProps = {
  label: string;
  inline?: boolean;
  className?: string;
};

type SkeletonVariant = "list" | "media" | "metric" | "chart" | "followup";

type SkeletonListProps = {
  rows?: number;
  compact?: boolean;
  variant?: SkeletonVariant;
  className?: string;
};

type LoadingBlockProps = {
  label: string;
  rows?: number;
  compact?: boolean;
  variant?: SkeletonVariant;
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

function SkeletonRow({ compact, index, variant }: { compact: boolean; index: number; variant: SkeletonVariant }) {
  if (variant === "media") {
    return (
      <div className={joinClasses("skeleton-card", "skeleton-card-media", compact ? "skeleton-card-compact" : null)}>
        <span className="skeleton-block skeleton-media-thumb" />
        <span className="skeleton-copy">
          <span className="skeleton-line skeleton-line-title" />
          <span className="skeleton-line skeleton-line-main" />
          <span className="skeleton-line skeleton-line-secondary" />
        </span>
        <span className="skeleton-side">
          <span className="skeleton-pill" />
          <span className="skeleton-pill skeleton-pill-short" />
        </span>
      </div>
    );
  }

  if (variant === "metric") {
    return (
      <div className={joinClasses("skeleton-card", "skeleton-card-metric", compact ? "skeleton-card-compact" : null)}>
        <span className="skeleton-copy">
          <span className="skeleton-line skeleton-line-title" />
          <span className="skeleton-line skeleton-line-secondary" />
        </span>
        <span className="skeleton-metric-value" />
      </div>
    );
  }

  if (variant === "chart") {
    return (
      <div className={joinClasses("skeleton-card", "skeleton-card-chart", compact ? "skeleton-card-compact" : null)}>
        <span className="skeleton-chart-row">
          <span className="skeleton-line skeleton-chart-label" />
          <span className="skeleton-line skeleton-chart-value" />
        </span>
        <span className="skeleton-chart-track">
          <span className="skeleton-chart-bar" style={{ width: `${88 - (index % 4) * 14}%` }} />
        </span>
      </div>
    );
  }

  if (variant === "followup") {
    return (
      <div className={joinClasses("skeleton-card", "skeleton-card-followup", compact ? "skeleton-card-compact" : null)}>
        <span className="skeleton-copy">
          <span className="skeleton-line skeleton-line-title" />
          <span className="skeleton-line skeleton-line-main" />
          <span className="skeleton-line skeleton-line-secondary" />
        </span>
        <span className="skeleton-actions">
          <span className="skeleton-pill" />
          <span className="skeleton-pill" />
        </span>
      </div>
    );
  }

  return (
    <div className={joinClasses("skeleton-card", compact ? "skeleton-card-compact" : null)}>
      <span className="skeleton-line skeleton-line-title" />
      <span className="skeleton-line skeleton-line-main" />
      <span className="skeleton-line skeleton-line-secondary" />
    </div>
  );
}

export function SkeletonList({ rows = 3, compact = false, variant = "list", className }: SkeletonListProps) {
  return (
    <div className={joinClasses("skeleton-list", `skeleton-list-${variant}`, className)} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <SkeletonRow key={index} compact={compact} index={index} variant={variant} />
      ))}
    </div>
  );
}

export function LoadingBlock({ label, rows = 3, compact = false, variant = "list", className }: LoadingBlockProps) {
  return (
    <div className={joinClasses("loading-block", `loading-block-${variant}`, className)} role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <SkeletonList rows={rows} compact={compact} variant={variant} />
    </div>
  );
}
