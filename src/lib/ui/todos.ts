type TodoTitleGenerationArgs = {
  currentTitle: string;
  sourceText?: string;
  threadId?: string;
};

type TodoTitleFreshCacheEntry = {
  title: string;
  createdAt: number;
};

const TODO_TITLE_FRESHNESS_TTL_MS = 5 * 60 * 1000;
const TODO_TITLE_FRESH_CACHE_MAX = 200;
const TODO_TITLE_FRESH_CACHE = new Map<string, TodoTitleFreshCacheEntry>();

function compactText(value: string, maxChars: number) {
  const normalized = value.trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 3)}...`;
}

function readFirstNonEmptyLine(text: string) {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

function normalizeTodoTitle(text: string) {
  let title = readFirstNonEmptyLine(text);
  title = title.replace(/^[-*•\d.)\s]+/, "").trim();
  title = title.replace(/^todo\s*[:\-]\s*/i, "").trim();
  title = title.replace(/^["'`]+/, "").replace(/["'`]+$/, "").trim();
  title = title.replace(/\s+/g, " ").trim();

  if (title.endsWith(".")) {
    title = title.slice(0, -1).trim();
  }
  if (title.length > 180) {
    title = `${title.slice(0, 177).trimEnd()}...`;
  }
  return title;
}

function normalizeFreshnessFragment(value: string | undefined, maxChars: number) {
  if (!value) {
    return "";
  }
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .slice(0, maxChars);
}

function buildTodoFreshnessKey(args: TodoTitleGenerationArgs) {
  return JSON.stringify({
    currentTitle: normalizeFreshnessFragment(args.currentTitle, 220),
    sourceText: normalizeFreshnessFragment(args.sourceText, 520),
    threadId: normalizeFreshnessFragment(args.threadId, 120),
  });
}

function pruneTodoFreshnessCache(now: number) {
  for (const [key, entry] of TODO_TITLE_FRESH_CACHE.entries()) {
    if (entry.createdAt + TODO_TITLE_FRESHNESS_TTL_MS <= now) {
      TODO_TITLE_FRESH_CACHE.delete(key);
    }
  }
  if (TODO_TITLE_FRESH_CACHE.size <= TODO_TITLE_FRESH_CACHE_MAX) {
    return;
  }
  const overflow = TODO_TITLE_FRESH_CACHE.size - TODO_TITLE_FRESH_CACHE_MAX;
  const keys = TODO_TITLE_FRESH_CACHE.keys();
  for (let index = 0; index < overflow; index += 1) {
    const next = keys.next();
    if (next.done) {
      break;
    }
    TODO_TITLE_FRESH_CACHE.delete(next.value);
  }
}

function buildTodoTitlePrompt(args: { currentTitle: string; sourceText?: string }) {
  const sourceText = args.sourceText?.trim() || "(No source message text provided)";
  const currentTitle = args.currentTitle.trim() || "(No current title)";

  return [
    "Generate one task title for a personal TODO list.",
    "Rules:",
    "- Return exactly one line.",
    "- No bullets, numbering, labels, or quotes.",
    "- Start with an action verb.",
    "- Keep it concise and specific.",
    `Current candidate title: ${compactText(currentTitle, 180)}`,
    `Source context: ${compactText(sourceText, 420)}`,
  ].join("\n");
}

async function readApiError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error?.trim()) {
      return payload.error;
    }
  } catch {
    // Ignore non-JSON payloads.
  }
  return `Request failed (${response.status}).`;
}

export async function generateTodoTitleWithAi(args: TodoTitleGenerationArgs) {
  const now = Date.now();
  const freshnessKey = buildTodoFreshnessKey(args);
  const cached = TODO_TITLE_FRESH_CACHE.get(freshnessKey);
  if (cached && now - cached.createdAt <= TODO_TITLE_FRESHNESS_TTL_MS) {
    return cached.title;
  }
  pruneTodoFreshnessCache(now);

  const response = await fetch("/api/actions/test-ai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: buildTodoTitlePrompt({
        currentTitle: args.currentTitle,
        sourceText: args.sourceText,
      }),
      threadId: args.threadId,
      purpose: "todo_title",
    }),
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  const payload = (await response.json()) as {
    replyText?: string;
    guardrailBlocked?: boolean;
    guardrailReason?: string;
  };

  if (payload.guardrailBlocked) {
    throw new Error(payload.guardrailReason?.trim() || "AI TODO generation blocked by guardrail.");
  }

  const aiText = typeof payload.replyText === "string" ? payload.replyText.trim() : "";
  const title = normalizeTodoTitle(aiText);
  if (!title) {
    throw new Error("AI returned an empty TODO title.");
  }
  TODO_TITLE_FRESH_CACHE.set(freshnessKey, {
    title,
    createdAt: now,
  });
  return title;
}
