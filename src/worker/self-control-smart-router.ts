export type SelfControlSmartRoute =
  | {
      tool: "none";
      reason?: string;
      confidence?: number;
    }
  | {
      tool: "openclaw";
      action: "forward" | "status" | "help";
      input?: string;
      reason?: string;
      confidence?: number;
    }
  | {
      tool: "codex_improve";
      action: "run" | "status" | "latest";
      input?: string;
      reason?: string;
      confidence?: number;
    };

type JsonRecord = Record<string, unknown>;

const OPENCLAW_STATUS_PATTERN = /\b(?:openclaw|claw)\s+(?:status|health|ping)\b/i;
const OPENCLAW_HELP_PATTERN = /\b(?:openclaw|claw)\s+help\b/i;
const CODEX_IMPROVE_STATUS_PATTERN =
  /\b(?:improve|self[-\s]?improve|self[-\s]?improvement)\s+(?:status|state|progress)\b/i;
const CODEX_IMPROVE_LATEST_PATTERN =
  /\b(?:improve|self[-\s]?improve|self[-\s]?improvement)\s+(?:latest|report|last(?:\s+run)?)\b/i;
const CODEX_IMPROVE_RUN_PATTERN =
  /\b(?:improve|self[-\s]?improve|self[-\s]?improvement|refactor|fix(?:\s+the)?\s+repo|update\s+the\s+worker)\b/i;

function normalizeWord(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizeTool(value: unknown): "openclaw" | "codex_improve" | "none" | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = normalizeWord(value);
  if (normalized === "none" || normalized === "skip") {
    return "none";
  }
  if (normalized === "openclaw" || normalized === "claw" || normalized === "open_claw") {
    return "openclaw";
  }
  if (
    normalized === "codex_improve" ||
    normalized === "codex" ||
    normalized === "self_improve" ||
    normalized === "self_improvement" ||
    normalized === "improve"
  ) {
    return "codex_improve";
  }
  return null;
}

function normalizeOpenClawAction(value: unknown): "forward" | "status" | "help" | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = normalizeWord(value);
  if (normalized === "forward" || normalized === "run" || normalized === "task" || normalized === "message") {
    return "forward";
  }
  if (normalized === "status" || normalized === "health" || normalized === "ping") {
    return "status";
  }
  if (normalized === "help") {
    return "help";
  }
  return null;
}

function normalizeCodexImproveAction(value: unknown): "run" | "status" | "latest" | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = normalizeWord(value);
  if (normalized === "run" || normalized === "improve" || normalized === "forward" || normalized === "task") {
    return "run";
  }
  if (normalized === "status" || normalized === "state" || normalized === "progress") {
    return "status";
  }
  if (normalized === "latest" || normalized === "report" || normalized === "last") {
    return "latest";
  }
  return null;
}

function toOptionalShortText(value: unknown, limit: number) {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, limit);
}

function toOptionalConfidence(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.min(1, value));
}

function parseJsonRecord(raw: string): JsonRecord | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const parseCandidate = (candidate: string) => {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      return parsed as JsonRecord;
    } catch {
      return null;
    }
  };

  const exact = parseCandidate(trimmed);
  if (exact) {
    return exact;
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    const sliced = parseCandidate(trimmed.slice(objectStart, objectEnd + 1));
    if (sliced) {
      return sliced;
    }
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();
  for (const line of lines) {
    const parsed = parseCandidate(line);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

export function parseSelfControlSmartRouteOutput(raw: string, fallbackInput: string): SelfControlSmartRoute | null {
  const parsed = parseJsonRecord(raw);
  if (!parsed) {
    return null;
  }

  const tool = normalizeTool(parsed.tool ?? parsed.target ?? parsed.route);
  if (!tool) {
    return null;
  }

  const reason = toOptionalShortText(parsed.reason, 220);
  const confidence = toOptionalConfidence(parsed.confidence);
  if (tool === "none") {
    return {
      tool: "none",
      ...(reason ? { reason } : {}),
      ...(typeof confidence === "number" ? { confidence } : {}),
    };
  }

  const actionValue = parsed.action ?? parsed.mode ?? parsed.intent;
  const candidateInput = toOptionalShortText(
    parsed.input ?? parsed.prompt ?? parsed.task ?? parsed.message,
    2_000,
  );

  if (tool === "openclaw") {
    const action = normalizeOpenClawAction(actionValue) || "forward";
    const input = action === "forward" ? candidateInput || fallbackInput : undefined;
    return {
      tool,
      action,
      ...(input ? { input } : {}),
      ...(reason ? { reason } : {}),
      ...(typeof confidence === "number" ? { confidence } : {}),
    };
  }

  const action = normalizeCodexImproveAction(actionValue) || "run";
  const input = action === "run" ? candidateInput || fallbackInput : undefined;
  return {
    tool,
    action,
    ...(input ? { input } : {}),
    ...(reason ? { reason } : {}),
    ...(typeof confidence === "number" ? { confidence } : {}),
  };
}

export function buildSelfControlSmartRouterPrompt(inputText: string) {
  return [
    "You route a self-chat message to one tool command.",
    "Available tools and actions:",
    '- openclaw: action in {"forward","status","help"}',
    '- codex_improve: action in {"run","status","latest"}',
    '- none: for plain notes with no action request',
    "Rules:",
    "- Prefer openclaw for general tasks, research, writing, file handling, and broad assistant requests.",
    "- Use codex_improve only for local repository self-improvement tasks.",
    "- If the user asks for progress/status/latest for improve runs, choose codex_improve status/latest.",
    "- Keep input concise and preserve the user intent.",
    'Return strict JSON only: {"tool":"...","action":"...","input":"...","reason":"...","confidence":0.0}',
    "If tool is none, omit action/input.",
    `Message: ${inputText}`,
  ].join("\n");
}

export function fallbackSelfControlSmartRoute(inputText: string): SelfControlSmartRoute {
  const raw = inputText.trim();
  if (!raw) {
    return { tool: "none", reason: "empty_message", confidence: 0.2 };
  }

  if (OPENCLAW_HELP_PATTERN.test(raw)) {
    return { tool: "openclaw", action: "help", reason: "explicit_openclaw_help", confidence: 0.9 };
  }
  if (OPENCLAW_STATUS_PATTERN.test(raw)) {
    return { tool: "openclaw", action: "status", reason: "explicit_openclaw_status", confidence: 0.9 };
  }
  if (CODEX_IMPROVE_STATUS_PATTERN.test(raw)) {
    return { tool: "codex_improve", action: "status", reason: "explicit_improve_status", confidence: 0.85 };
  }
  if (CODEX_IMPROVE_LATEST_PATTERN.test(raw)) {
    return { tool: "codex_improve", action: "latest", reason: "explicit_improve_latest", confidence: 0.85 };
  }
  if (CODEX_IMPROVE_RUN_PATTERN.test(raw)) {
    return { tool: "codex_improve", action: "run", input: raw, reason: "improve_keyword", confidence: 0.75 };
  }
  return { tool: "openclaw", action: "forward", input: raw, reason: "default_openclaw", confidence: 0.65 };
}
