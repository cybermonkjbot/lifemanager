export function parseSelfControlCommandText(args: { rawText: string; prefix?: string }) {
  const raw = (args.rawText || "").trim();
  if (!raw) {
    return null;
  }

  const prefix = (args.prefix || "").trim();
  if (!prefix) {
    return raw;
  }

  const rawLower = raw.toLowerCase();
  const prefixLower = prefix.toLowerCase();
  if (!rawLower.startsWith(prefixLower)) {
    return null;
  }

  const rest = raw.slice(prefix.length);
  if (!rest) {
    return null;
  }
  if (!/^[\s:\-]/.test(rest)) {
    return null;
  }

  const command = rest.replace(/^[\s:\-]+/, "").trim();
  return command || null;
}
