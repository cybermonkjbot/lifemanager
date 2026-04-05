import { DEFAULT_DELAY_RANGE_MS, DEFAULT_TYPING_RANGE_MS } from "./constants";

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

export function detectTodoCandidate(text: string): null | { title: string; suggestedDueAt?: number } {
  const t = text.trim();
  const lowered = t.toLowerCase();

  if (/(remind me|don'?t forget|please send|need to)/i.test(t)) {
    return {
      title: t.slice(0, 110),
      suggestedDueAt: lowered.includes("tomorrow") ? Date.now() + 24 * 60 * 60 * 1000 : undefined,
    };
  }

  return null;
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
