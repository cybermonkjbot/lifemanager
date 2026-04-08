export type RuntimeCommandAction = "pause" | "resume" | "restart" | "status";
export type RuntimeCommandTarget = "worker" | "app" | "both";

export type RuntimeCommand = {
  action: RuntimeCommandAction;
  target: RuntimeCommandTarget;
  raw: string;
};

const ACTION_SYNONYMS: Record<RuntimeCommandAction, string[]> = {
  pause: ["pause", "stop", "hold", "freeze"],
  resume: ["resume", "unpause", "continue", "start"],
  restart: ["restart", "reboot", "reload"],
  status: ["status", "state", "health"],
};

const PREFIX_WORDS = new Set(["slm", "/slm", "!slm", "runtime", "/runtime", "cmd", "command"]);
const WORKER_WORDS = new Set(["worker", "bot", "listener", "engine"]);
const APP_WORDS = new Set(["app", "dashboard", "next", "ui", "server"]);
const BOTH_WORDS = new Set(["both", "all", "everything"]);

function normalizeTokens(input: string) {
  return input
    .toLowerCase()
    .replace(/[^\w\s/!&-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function detectAction(tokens: string[]): RuntimeCommandAction | null {
  let found: RuntimeCommandAction | null = null;
  for (const token of tokens) {
    for (const [action, words] of Object.entries(ACTION_SYNONYMS) as Array<[RuntimeCommandAction, string[]]>) {
      if (!words.includes(token)) {
        continue;
      }
      if (found && found !== action) {
        return null;
      }
      found = action;
    }
  }
  return found;
}

function detectTarget(tokens: string[]): RuntimeCommandTarget | null {
  const hasWorker = tokens.some((token) => WORKER_WORDS.has(token));
  const hasApp = tokens.some((token) => APP_WORDS.has(token));
  const hasBothWord = tokens.some((token) => BOTH_WORDS.has(token));

  if (hasBothWord || (hasWorker && hasApp)) {
    return "both";
  }
  if (hasWorker) {
    return "worker";
  }
  if (hasApp) {
    return "app";
  }
  return null;
}

function hasCommandIntent(tokens: string[], action: RuntimeCommandAction, target: RuntimeCommandTarget) {
  const first = tokens[0] || "";
  const startsWithAction = ACTION_SYNONYMS[action].includes(first);
  const startsWithPrefix = PREFIX_WORDS.has(first);
  const startsWithTarget =
    (target === "worker" && WORKER_WORDS.has(first)) ||
    (target === "app" && APP_WORDS.has(first)) ||
    (target === "both" && (BOTH_WORDS.has(first) || WORKER_WORDS.has(first) || APP_WORDS.has(first)));
  return startsWithAction || startsWithPrefix || startsWithTarget;
}

export function parseRuntimeCommand(text: string): RuntimeCommand | null {
  const raw = (text || "").trim();
  if (!raw) {
    return null;
  }

  const tokens = normalizeTokens(raw);
  if (tokens.length === 0) {
    return null;
  }

  const action = detectAction(tokens);
  const target = detectTarget(tokens);
  if (!action || !target) {
    return null;
  }

  if (!hasCommandIntent(tokens, action, target)) {
    return null;
  }

  return { action, target, raw };
}
