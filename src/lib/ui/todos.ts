type TodoTitleGenerationArgs = {
  currentTitle: string;
  sourceText?: string;
  threadId?: string;
};

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
  return title;
}
