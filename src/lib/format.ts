export function formatDateTime(ms: number | undefined | null) {
  if (!ms) {
    return "-";
  }
  return new Date(ms).toLocaleString();
}

export function formatRelativeTime(ms: number | undefined | null, now = Date.now()) {
  if (!ms) {
    return "-";
  }
  const diffMs = ms - now;
  const absMs = Math.abs(diffMs);
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (absMs < minuteMs) {
    return diffMs >= 0 ? "in <1m" : "<1m ago";
  }

  if (absMs < hourMs) {
    const value = Math.round(absMs / minuteMs);
    return diffMs >= 0 ? `in ${value}m` : `${value}m ago`;
  }

  if (absMs < dayMs) {
    const value = Math.round(absMs / hourMs);
    return diffMs >= 0 ? `in ${value}h` : `${value}h ago`;
  }

  const value = Math.round(absMs / dayMs);
  return diffMs >= 0 ? `in ${value}d` : `${value}d ago`;
}

export function formatDateTimeWithRelative(ms: number | undefined | null, now = Date.now()) {
  if (!ms) {
    return "-";
  }
  return `${formatDateTime(ms)} (${formatRelativeTime(ms, now)})`;
}

export function trim(text: string, max = 120) {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}
