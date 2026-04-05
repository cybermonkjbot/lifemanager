export function formatDateTime(ms: number | undefined | null) {
  if (!ms) {
    return "-";
  }
  return new Date(ms).toLocaleString();
}

export function trim(text: string, max = 120) {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}
