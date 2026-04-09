export function isSelfControlHelpCommand(text: string) {
  const normalized = (text || "")
    .trim()
    .toLowerCase()
    .replace(/[^\w\s/!-]+/g, " ")
    .replace(/\s+/g, " ");

  if (!normalized) {
    return false;
  }

  const allowed = new Set([
    "help",
    "/slm help",
    "slm help",
    "!slm help",
    "runtime help",
    "/runtime help",
    "cmd help",
    "command help",
    "improve help",
    "self-improve help",
    "self improve help",
    "codex help",
    "codex improve help",
  ]);

  return allowed.has(normalized);
}
