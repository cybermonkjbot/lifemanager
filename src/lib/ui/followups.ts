import type { Id } from "../../../convex/_generated/dataModel";

export type FollowupStatus = "suggested" | "confirmed" | "queued" | "sent" | "failed" | "cancelled";
export type FollowupKind = "promise" | "request" | "plan";
export type FollowupDirection = "inbound" | "outbound";

export type FollowupSourceMessage = {
  text?: string;
  messageAt?: number;
  direction?: FollowupDirection;
};

export type FollowupThreadRef = {
  _id?: string;
  title?: string;
  jid?: string;
};

export type FollowupItem = {
  _id: string;
  threadId?: string;
  reason: string;
  dueAt: number;
  status: FollowupStatus;
  kind?: FollowupKind;
  direction?: FollowupDirection;
  confidence?: number;
  sourceSnippet?: string;
  thread?: FollowupThreadRef | null;
  sourceMessage?: FollowupSourceMessage | null;
};

type RunAction = (
  key: string,
  action: () => Promise<void>,
  options: {
    pendingLabel: string;
    successMessage: string;
  },
) => void;

type FollowupMutations = {
  confirmFollowup: (args: { followUpId: Id<"followUps"> }) => Promise<unknown>;
  snoozeFollowup: (args: { followUpId: Id<"followUps">; minutes: number }) => Promise<unknown>;
  rescheduleFollowup: (args: { followUpId: Id<"followUps">; dueAt: number }) => Promise<unknown>;
  cancelFollowup: (args: { followUpId: Id<"followUps"> }) => Promise<unknown>;
};

export function followupStatusLabel(status: FollowupStatus) {
  if (status === "suggested") {
    return "Needs review";
  }
  if (status === "confirmed") {
    return "Confirmed";
  }
  if (status === "queued") {
    return "Queued";
  }
  if (status === "sent") {
    return "Sent";
  }
  if (status === "failed") {
    return "Failed";
  }
  return "Dismissed";
}

export function followupCommitmentLabel(item: Pick<FollowupItem, "direction" | "kind">) {
  if (item.direction === "outbound" && item.kind !== "request") {
    return "You promised";
  }
  if (item.direction === "inbound" && item.kind === "request") {
    return "They requested";
  }
  if (item.kind === "plan") {
    return "Shared plan";
  }
  return "Commitment";
}

export function followupRescheduleDueAt(hoursAhead: number, now = Date.now()) {
  return now + Math.max(1, Math.round(hoursAhead)) * 60 * 60 * 1000;
}

export function createFollowupActionHandlers(args: {
  runAction: RunAction;
  mutations: FollowupMutations;
}) {
  const { runAction, mutations } = args;

  const onConfirm = (followUpId: string) => {
    const key = `followup:${followUpId}`;
    void runAction(
      key,
      async () => {
        await mutations.confirmFollowup({ followUpId: followUpId as Id<"followUps"> });
      },
      {
        pendingLabel: "Confirming…",
        successMessage: "Follow-up confirmed.",
      },
    );
  };

  const onSnooze = (followUpId: string, minutes: number) => {
    const key = `followup:snooze:${followUpId}`;
    void runAction(
      key,
      async () => {
        await mutations.snoozeFollowup({ followUpId: followUpId as Id<"followUps">, minutes });
      },
      {
        pendingLabel: "Snoozing…",
        successMessage: "Follow-up snoozed.",
      },
    );
  };

  const onReschedule = (followUpId: string, hoursAhead: number) => {
    const key = `followup:reschedule:${followUpId}`;
    void runAction(
      key,
      async () => {
        await mutations.rescheduleFollowup({
          followUpId: followUpId as Id<"followUps">,
          dueAt: followupRescheduleDueAt(hoursAhead),
        });
      },
      {
        pendingLabel: "Rescheduling…",
        successMessage: "Follow-up rescheduled.",
      },
    );
  };

  const onDismiss = (followUpId: string) => {
    const key = `followup:cancel:${followUpId}`;
    void runAction(
      key,
      async () => {
        await mutations.cancelFollowup({ followUpId: followUpId as Id<"followUps"> });
      },
      {
        pendingLabel: "Dismissing…",
        successMessage: "Follow-up dismissed.",
      },
    );
  };

  return {
    onConfirm,
    onSnooze,
    onReschedule,
    onDismiss,
  };
}

type FollowupReasonGenerationArgs = {
  currentReason: string;
  sourceText?: string;
  dueAt?: number;
  threadId?: string;
};

const FOLLOWUP_REASON_FRESHNESS_TTL_MS = 5 * 60 * 1000;
const FOLLOWUP_REASON_FRESH_CACHE_MAX = 200;
const FOLLOWUP_REASON_FRESH_CACHE = new Map<string, { reason: string; createdAt: number }>();

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

function normalizeFollowupReason(text: string) {
  let reason = readFirstNonEmptyLine(text);
  reason = reason.replace(/^[-*•\d.)\s]+/, "").trim();
  reason = reason.replace(/^follow[\s-]?up\s*[:\-]\s*/i, "").trim();
  reason = reason.replace(/^["'`]+/, "").replace(/["'`]+$/, "").trim();
  reason = reason.replace(/\s+/g, " ").trim();
  if (reason.endsWith(".")) {
    reason = reason.slice(0, -1).trim();
  }
  if (reason.length > 220) {
    reason = `${reason.slice(0, 217).trimEnd()}...`;
  }
  return reason;
}

function buildFollowupFreshnessKey(args: FollowupReasonGenerationArgs) {
  return JSON.stringify({
    currentReason: normalizeFreshnessFragment(args.currentReason, 260),
    sourceText: normalizeFreshnessFragment(args.sourceText, 520),
    dueAt: Number.isFinite(args.dueAt) ? Math.round(args.dueAt as number) : null,
    threadId: normalizeFreshnessFragment(args.threadId, 120),
  });
}

function pruneFollowupFreshnessCache(now: number) {
  for (const [key, entry] of FOLLOWUP_REASON_FRESH_CACHE.entries()) {
    if (entry.createdAt + FOLLOWUP_REASON_FRESHNESS_TTL_MS <= now) {
      FOLLOWUP_REASON_FRESH_CACHE.delete(key);
    }
  }
  if (FOLLOWUP_REASON_FRESH_CACHE.size <= FOLLOWUP_REASON_FRESH_CACHE_MAX) {
    return;
  }
  const overflow = FOLLOWUP_REASON_FRESH_CACHE.size - FOLLOWUP_REASON_FRESH_CACHE_MAX;
  const keys = FOLLOWUP_REASON_FRESH_CACHE.keys();
  for (let index = 0; index < overflow; index += 1) {
    const next = keys.next();
    if (next.done) {
      break;
    }
    FOLLOWUP_REASON_FRESH_CACHE.delete(next.value);
  }
}

function buildFollowupReasonPrompt(args: FollowupReasonGenerationArgs) {
  const sourceText = args.sourceText?.trim() || "(No source message text provided)";
  const currentReason = args.currentReason.trim() || "(No current reason)";
  const dueLabel = args.dueAt ? new Date(args.dueAt).toLocaleString() : "unspecified";
  return [
    "Generate one concise follow-up reason for a reminder queue item.",
    "Rules:",
    "- Return exactly one line.",
    "- No bullets, numbering, labels, or quotes.",
    "- Keep it specific to the source context and actionable.",
    "- Do not include greetings.",
    `Current reason: ${compactText(currentReason, 220)}`,
    `Due at: ${dueLabel}`,
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

export async function generateFollowupReasonWithAi(args: FollowupReasonGenerationArgs) {
  const now = Date.now();
  const freshnessKey = buildFollowupFreshnessKey(args);
  const cached = FOLLOWUP_REASON_FRESH_CACHE.get(freshnessKey);
  if (cached && now - cached.createdAt <= FOLLOWUP_REASON_FRESHNESS_TTL_MS) {
    return cached.reason;
  }
  pruneFollowupFreshnessCache(now);

  const response = await fetch("/api/actions/test-ai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: buildFollowupReasonPrompt(args),
      threadId: args.threadId,
      purpose: "followup_reason",
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
    throw new Error(payload.guardrailReason?.trim() || "AI follow-up reason generation blocked by guardrail.");
  }

  const aiText = typeof payload.replyText === "string" ? payload.replyText.trim() : "";
  const reason = normalizeFollowupReason(aiText);
  if (!reason) {
    throw new Error("AI returned an empty follow-up reason.");
  }
  FOLLOWUP_REASON_FRESH_CACHE.set(freshnessKey, {
    reason,
    createdAt: now,
  });
  return reason;
}
