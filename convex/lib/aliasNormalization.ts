const ALIAS_TOKEN_PATTERN = /^[a-z][a-z0-9_-]{1,24}$/i;

const NON_NAME_ALIAS_TOKENS = new Set([
  "a",
  "an",
  "and",
  "better",
  "confused",
  "easy",
  "easier",
  "expected",
  "fair",
  "fine",
  "going",
  "good",
  "great",
  "heading",
  "hard",
  "its",
  "it",
  "just",
  "lost",
  "me",
  "nothing",
  "okay",
  "ok",
  "perfect",
  "safe",
  "the",
  "this",
]);

export function sanitizeExtractedAliasToken(value: string | undefined) {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.toLowerCase();
  if (!ALIAS_TOKEN_PATTERN.test(trimmed) || NON_NAME_ALIAS_TOKENS.has(normalized)) {
    return null;
  }
  return trimmed;
}

export function normalizeAliasForStorage(value: string | undefined) {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.toLowerCase();
  if (ALIAS_TOKEN_PATTERN.test(trimmed) && NON_NAME_ALIAS_TOKENS.has(normalized)) {
    return null;
  }
  return trimmed.slice(0, 50);
}

export function dedupeAliases(values: Array<string | null | undefined>, maxAliases = 20) {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const alias = normalizeAliasForStorage(value || undefined);
    if (!alias) {
      continue;
    }
    const key = alias.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(alias);
    if (deduped.length >= maxAliases) {
      break;
    }
  }
  return deduped;
}
