import type { ReactNode } from "react";

export type EmptyStateVariant =
  | "backlog"
  | "conversation"
  | "followups"
  | "generic"
  | "media"
  | "queue"
  | "rules"
  | "settings"
  | "status"
  | "style"
  | "tasks";

type EmptyStateProps = {
  title: string;
  description?: string;
  variant?: EmptyStateVariant;
  compact?: boolean;
  className?: string;
  children?: ReactNode;
};

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function EmptyStateGraphic({ variant }: { variant: EmptyStateVariant }) {
  const commonProps = {
    className: "empty-state-graphic",
    viewBox: "0 0 160 120",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": true,
    focusable: false,
  } as const;

  if (variant === "queue") {
    return (
      <svg {...commonProps}>
        <path className="empty-art-fill-primary" d="M33 78h58l13 17H46L33 78Z" />
        <path className="empty-art-stroke" d="M36 42h70l14 19H50L36 42Z" />
        <path className="empty-art-stroke" d="M45 61h70l14 19H59L45 61Z" />
        <path className="empty-art-stroke-strong" d="M55 88l10 10 23-27" />
        <path className="empty-art-accent" d="M112 27l4 10 10 4-10 4-4 10-4-10-10-4 10-4 4-10Z" />
      </svg>
    );
  }

  if (variant === "backlog") {
    return (
      <svg {...commonProps}>
        <path className="empty-art-stroke" d="M35 39h65l18 57H52L35 39Z" />
        <path className="empty-art-fill-primary" d="M48 71h35l8 13h34l4 12H55L48 71Z" />
        <path className="empty-art-stroke-strong" d="M105 38a18 18 0 1 0 0 36 18 18 0 0 0 0-36Z" />
        <path className="empty-art-stroke-strong" d="M105 48v10l7 5" />
        <path className="empty-art-accent" d="M39 24h33" />
      </svg>
    );
  }

  if (variant === "conversation") {
    return (
      <svg {...commonProps}>
        <path className="empty-art-fill-primary" d="M35 34h64c8 0 14 6 14 14v20c0 8-6 14-14 14H68L46 98V82H35c-8 0-14-6-14-14V48c0-8 6-14 14-14Z" />
        <path className="empty-art-stroke-strong" d="M62 43h56c8 0 14 6 14 14v19c0 8-6 14-14 14h-9v14L90 90H62c-8 0-14-6-14-14V57c0-8 6-14 14-14Z" />
        <path className="empty-art-accent" d="M61 61h48M61 74h33" />
      </svg>
    );
  }

  if (variant === "media") {
    return (
      <svg {...commonProps}>
        <path className="empty-art-fill-primary" d="M35 32h72c8 0 14 6 14 14v48H49c-8 0-14-6-14-14V32Z" />
        <path className="empty-art-stroke-strong" d="M47 45h79v52H47V45Z" />
        <path className="empty-art-accent" d="M64 80l17-17 13 14 9-9 15 20H58l6-8Z" />
        <path className="empty-art-stroke" d="M68 56h1M35 57h12M126 57h12M35 73h12M126 73h12M35 89h12M126 89h12" />
      </svg>
    );
  }

  if (variant === "status") {
    return (
      <svg {...commonProps}>
        <path className="empty-art-stroke" d="M80 25a44 44 0 1 0 44 44" />
        <path className="empty-art-fill-primary" d="M80 42a27 27 0 1 0 27 27A27 27 0 0 0 80 42Z" />
        <path className="empty-art-stroke-strong" d="M66 70l10 10 23-28" />
        <path className="empty-art-accent" d="M120 23l4 10 10 4-10 4-4 10-4-10-10-4 10-4 4-10Z" />
      </svg>
    );
  }

  if (variant === "followups" || variant === "tasks") {
    return (
      <svg {...commonProps}>
        <path className="empty-art-fill-primary" d="M42 31h76v66H42V31Z" />
        <path className="empty-art-stroke-strong" d="M42 43h76M58 24v15M102 24v15M42 31h76v66H42V31Z" />
        <path className="empty-art-accent" d="M57 61l7 7 13-16M57 82l7 7 13-16" />
        <path className="empty-art-stroke" d="M88 63h18M88 84h18" />
      </svg>
    );
  }

  if (variant === "rules") {
    return (
      <svg {...commonProps}>
        <path className="empty-art-fill-primary" d="M80 23l43 16v27c0 27-18 45-43 53-25-8-43-26-43-53V39l43-16Z" />
        <path className="empty-art-stroke-strong" d="M80 23l43 16v27c0 27-18 45-43 53-25-8-43-26-43-53V39l43-16Z" />
        <path className="empty-art-accent" d="M60 78l40-40" />
        <path className="empty-art-stroke" d="M63 45h33M58 61h44" />
      </svg>
    );
  }

  if (variant === "settings") {
    return (
      <svg {...commonProps}>
        <path className="empty-art-stroke" d="M36 42h88M36 70h88M36 98h88" />
        <path className="empty-art-fill-primary" d="M61 29a13 13 0 1 0 0 26 13 13 0 0 0 0-26ZM100 57a13 13 0 1 0 0 26 13 13 0 0 0 0-26ZM76 85a13 13 0 1 0 0 26 13 13 0 0 0 0-26Z" />
        <path className="empty-art-stroke-strong" d="M61 29a13 13 0 1 0 0 26 13 13 0 0 0 0-26ZM100 57a13 13 0 1 0 0 26 13 13 0 0 0 0-26ZM76 85a13 13 0 1 0 0 26 13 13 0 0 0 0-26Z" />
      </svg>
    );
  }

  if (variant === "style") {
    return (
      <svg {...commonProps}>
        <path className="empty-art-fill-primary" d="M47 81l47-47 20 20-47 47-28 8 8-28Z" />
        <path className="empty-art-stroke-strong" d="M47 81l47-47 20 20-47 47-28 8 8-28ZM87 41l20 20" />
        <path className="empty-art-accent" d="M50 86l12 12" />
        <path className="empty-art-stroke" d="M41 33h32M36 51h27M99 91h25" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path className="empty-art-fill-primary" d="M80 24l42 20v32l-42 20-42-20V44l42-20Z" />
      <path className="empty-art-stroke-strong" d="M80 24l42 20v32l-42 20-42-20V44l42-20Z" />
      <path className="empty-art-accent" d="M80 43v35M62 55l18 23 18-23" />
      <path className="empty-art-stroke" d="M52 94h56" />
    </svg>
  );
}

export function EmptyState({
  title,
  description,
  variant = "generic",
  compact = false,
  className,
  children,
}: EmptyStateProps) {
  return (
    <div className={joinClasses("empty-line", "empty-state", compact ? "empty-state-compact" : null, className)}>
      <EmptyStateGraphic variant={variant} />
      <div className="empty-state-copy">
        <p className="empty-state-title">{title}</p>
        {description ? <p className="empty-state-description">{description}</p> : null}
        {children ? <div className="empty-state-actions">{children}</div> : null}
      </div>
    </div>
  );
}
