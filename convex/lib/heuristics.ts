import { DEFAULT_DELAY_RANGE_MS, DEFAULT_TYPING_RANGE_MS } from "./constants";
import { detectFutureCommitment } from "./commitments";
import type { CommitmentDirection } from "./commitments";

export type GuardrailResult = {
  blocked: boolean;
  severity: "low" | "medium" | "high";
  reason: string;
};

const HIGH_RISK_PATTERNS = [
  /password/i,
  /otp/i,
  /bank\s*account/i,
  /wire\s*transfer/i,
  /social\s*security/i,
];

const MEDIUM_RISK_PATTERNS = [/medical/i, /lawsuit/i, /contract/i, /refund/i];
const TODO_COMMITMENT_INTENT_REGEX = /\b(i(?:'|’)ll|i will|let me|i can|i(?:'|’)m going to|on it|leave it with me)\b/i;
const TODO_ACCEPTANCE_ONLY_REGEX = /^(yes|yeah|yep|sure|ok(?:ay)?|alright|sounds good|deal|on it|got it|i got you)[.!]*$/i;
const TODO_ACTION_VERB_REGEX =
  /\b(send|share|call|text|reply|update|follow[\s-]?up|check|confirm|review|deliver|pay|transfer|book|schedule|remind|bring|drop|submit|finish|complete|handle)\b/i;
const TODO_REQUEST_PREFIX_REGEX =
  /^(can you|could you|will you|would you|please|remember to|don(?:'|’)t forget to|make sure you)\s+/i;

export function evaluateGuardrail(text: string): GuardrailResult {
  if (HIGH_RISK_PATTERNS.some((p) => p.test(text))) {
    return {
      blocked: true,
      severity: "high",
      reason: "High-risk sensitive topic detected.",
    };
  }

  if (MEDIUM_RISK_PATTERNS.some((p) => p.test(text))) {
    return {
      blocked: false,
      severity: "medium",
      reason: "Potentially sensitive topic detected.",
    };
  }

  return {
    blocked: false,
    severity: "low",
    reason: "No significant guardrail risk.",
  };
}

export function detectPromiseOrPlan(text: string): null | { reason: string; dueAt: number } {
  const trimmed = text.trim();
  const now = Date.now();

  if (/\b(i('|’)ll|i will)\b/i.test(trimmed)) {
    if (/tomorrow/i.test(trimmed)) {
      return {
        reason: "Promise mentions tomorrow.",
        dueAt: now + 24 * 60 * 60 * 1000,
      };
    }

    if (/next\s+week/i.test(trimmed)) {
      return {
        reason: "Promise mentions next week.",
        dueAt: now + 7 * 24 * 60 * 60 * 1000,
      };
    }

    return {
      reason: "Future commitment detected.",
      dueAt: now + 24 * 60 * 60 * 1000,
    };
  }

  if (/\b(plan|let'?s|lets)\b/i.test(trimmed) && /\b(tomorrow|later|weekend|next week)\b/i.test(trimmed)) {
    return {
      reason: "Future plan language detected.",
      dueAt: now + 2 * 24 * 60 * 60 * 1000,
    };
  }

  return null;
}

function compactText(text: string | undefined) {
  return (text || "").trim().replace(/\s+/g, " ");
}

function stripRequestPrefix(text: string) {
  return text.replace(TODO_REQUEST_PREFIX_REGEX, "").replace(/\?\s*$/, "").trim();
}

function inferDueHint(text: string, now: number) {
  const lowered = text.toLowerCase();
  if (lowered.includes("tomorrow")) {
    return now + 24 * 60 * 60 * 1000;
  }
  if (lowered.includes("next week")) {
    return now + 7 * 24 * 60 * 60 * 1000;
  }
  if (lowered.includes("later today") || /\btoday\b/i.test(lowered)) {
    return now + 4 * 60 * 60 * 1000;
  }
  if (lowered.includes("tonight") || lowered.includes("this evening")) {
    return now + 8 * 60 * 60 * 1000;
  }
  return undefined;
}

export function detectTodoCandidate(args: {
  text: string;
  direction: CommitmentDirection;
  now?: number;
  contextText?: string;
}): null | { title: string; suggestedDueAt?: number } {
  if (args.direction !== "outbound") {
    return null;
  }

  const outboundText = compactText(args.text);
  if (!outboundText) {
    return null;
  }

  const hasCommitmentIntent = TODO_COMMITMENT_INTENT_REGEX.test(outboundText);
  const isAcceptanceOnly = TODO_ACCEPTANCE_ONLY_REGEX.test(outboundText);
  if (!hasCommitmentIntent && !isAcceptanceOnly) {
    return null;
  }

  const contextText = compactText(args.contextText);
  const actionCorpus = `${outboundText} ${contextText}`.trim();
  if (!TODO_ACTION_VERB_REGEX.test(actionCorpus)) {
    return null;
  }

  const now = args.now ?? Date.now();
  const commitment = detectFutureCommitment({
    text: outboundText,
    direction: "outbound",
    now,
  });
  const suggestedDueAt =
    commitment.outcome === "actionable" ? commitment.candidate.dueAt : inferDueHint(actionCorpus, now);

  const titleSource = isAcceptanceOnly && contextText ? stripRequestPrefix(contextText) : outboundText;
  const title = compactText(titleSource).slice(0, 110);
  if (!title) {
    return null;
  }

  return {
    title,
    suggestedDueAt,
  };
}

export function estimateHumanTiming(text: string) {
  const len = Math.max(text.length, 10);
  const [minDelay, maxDelay] = DEFAULT_DELAY_RANGE_MS;
  const [minTyping, maxTyping] = DEFAULT_TYPING_RANGE_MS;

  const pacingBias = Math.min(len / 350, 1);
  const delayMs = Math.round(minDelay + (maxDelay - minDelay) * (0.35 + pacingBias * 0.5));
  const typingMs = Math.round(minTyping + (maxTyping - minTyping) * Math.min(len / 240, 1));

  return {
    delayMs,
    typingMs,
  };
}

export function looksLikeQuestion(text: string) {
  return /\?|\b(can you|could you|when|where|what|why|how)\b/i.test(text);
}
