export type SelfControlManagerTool =
  | "runtime_command"
  | "openclaw_forward"
  | "openclaw_status"
  | "codex_improve_run"
  | "codex_improve_status"
  | "codex_improve_latest"
  | "settings_get"
  | "threads_list_contacts"
  | "outreach_run"
  | "agenda_create_range"
  | "none";

export type SelfControlManagerPlanStep = {
  tool: SelfControlManagerTool;
  args?: Record<string, unknown>;
  reason?: string;
};

export type SelfControlManagerPlan = {
  summary?: string;
  steps: SelfControlManagerPlanStep[];
  confidence?: number;
};

export const SELF_CONTROL_MANAGER_TOOL_REGISTRY: Record<
  Exclude<SelfControlManagerTool, "none">,
  {
    purpose: string;
    argsShape: string;
  }
> = {
  runtime_command: {
    purpose: "Control app/worker runtime state from self chat.",
    argsShape: '{ "command": "pause worker|resume worker|restart worker|status worker|..." }',
  },
  openclaw_forward: {
    purpose: "Delegate an unstructured task to OpenClaw.",
    argsShape: '{ "input": "task for OpenClaw" }',
  },
  openclaw_status: {
    purpose: "Check OpenClaw CLI readiness.",
    argsShape: "{}",
  },
  codex_improve_run: {
    purpose: "Launch repository self-improvement run.",
    argsShape: '{ "prompt": "repo improvement task" }',
  },
  codex_improve_status: {
    purpose: "Read current self-improvement status.",
    argsShape: "{}",
  },
  codex_improve_latest: {
    purpose: "Fetch latest self-improvement report summary.",
    argsShape: "{}",
  },
  settings_get: {
    purpose: "Read active runtime/settings snapshot.",
    argsShape: "{}",
  },
  threads_list_contacts: {
    purpose: "List recent direct-thread contacts for planning.",
    argsShape: '{ "limit": 20, "provider": "all|whatsapp|instagram" }',
  },
  outreach_run: {
    purpose: "Trigger immediate outreach batch with current settings.",
    argsShape: "{}",
  },
  agenda_create_range: {
    purpose: "Create agenda todos across a date range.",
    argsShape: '{ "agenda": "title", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "time": "HH:MM" }',
  },
};

type JsonRecord = Record<string, unknown>;

function normalizeWord(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizeTool(value: unknown): SelfControlManagerTool | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = normalizeWord(value);
  if (
    normalized === "runtime_command" ||
    normalized === "openclaw_forward" ||
    normalized === "openclaw_status" ||
    normalized === "codex_improve_run" ||
    normalized === "codex_improve_status" ||
    normalized === "codex_improve_latest" ||
    normalized === "settings_get" ||
    normalized === "threads_list_contacts" ||
    normalized === "outreach_run" ||
    normalized === "agenda_create_range" ||
    normalized === "none"
  ) {
    return normalized;
  }
  return null;
}

function parseJsonRecord(raw: string): JsonRecord | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as JsonRecord;
  } catch {
    // Continue below to try extracting an embedded JSON object.
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    try {
      const parsed = JSON.parse(trimmed.slice(objectStart, objectEnd + 1)) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as JsonRecord;
      }
    } catch {
      return null;
    }
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

export function buildSelfControlManagerPrompt(inputText: string) {
  return [
    "You are the self-control manager planner for a messaging automation system.",
    "You are the primary orchestrator above direct OpenClaw/Codex command syntax.",
    "Plan tool calls for the user message. Return strict JSON only.",
    "Tools:",
    '- runtime_command args: {"command":"pause worker|resume worker|restart worker|status worker|..."}',
    '- openclaw_forward args: {"input":"task for OpenClaw"}',
    "- openclaw_status args: {}",
    '- codex_improve_run args: {"prompt":"repo improvement task"}',
    "- codex_improve_status args: {}",
    "- codex_improve_latest args: {}",
    "- settings_get args: {}",
    '- threads_list_contacts args: {"limit":20,"provider":"all|whatsapp|instagram"}',
    "- outreach_run args: {}",
    '- agenda_create_range args: {"agenda":"title","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","time":"HH:MM"}',
    "- none args: {}",
    "Rules:",
    "- Prefer direct system tools (settings/threads/outreach/agenda/runtime) before openclaw when request is explicit.",
    "- Handle requests even when they already mention openclaw/codex; do not require special wake words.",
    "- Use openclaw_forward for broad, unstructured tasks or when tool coverage is insufficient.",
    "- Keep to <=3 steps.",
    'Return JSON schema: {"summary":"...","confidence":0.0,"steps":[{"tool":"...","args":{},"reason":"..."}]}',
    `Message: ${inputText}`,
  ].join("\n");
}

export function parseSelfControlManagerOutput(raw: string): SelfControlManagerPlan | null {
  const parsed = parseJsonRecord(raw);
  if (!parsed) {
    return null;
  }

  const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
  const steps: SelfControlManagerPlanStep[] = [];
  for (const stepValue of rawSteps) {
    if (!stepValue || typeof stepValue !== "object" || Array.isArray(stepValue)) {
      continue;
    }
    const step = stepValue as JsonRecord;
    const tool = normalizeTool(step.tool ?? step.name ?? step.action);
    if (!tool) {
      continue;
    }
    const args =
      step.args && typeof step.args === "object" && !Array.isArray(step.args) ? (step.args as Record<string, unknown>) : undefined;
    steps.push({
      tool,
      ...(args ? { args } : {}),
      ...(toOptionalShortText(step.reason, 220) ? { reason: toOptionalShortText(step.reason, 220) } : {}),
    });
  }

  if (steps.length === 0) {
    return null;
  }

  return {
    steps: steps.slice(0, 3),
    ...(toOptionalShortText(parsed.summary, 220) ? { summary: toOptionalShortText(parsed.summary, 220) } : {}),
    ...(typeof toOptionalConfidence(parsed.confidence) === "number"
      ? { confidence: toOptionalConfidence(parsed.confidence) }
      : {}),
  };
}
