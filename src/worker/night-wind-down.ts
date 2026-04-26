const ROBOTIC_CUE_PATTERN =
  /\b(protocol|automation|workflow|scheduled|compliance|assistant|task\s*manager|system\s*rule|quiet\s*hours?|night\s*wind\s*down|wind\s*down\s*mode)\b/i;

const AWKWARD_MORNING_PHRASE_PATTERN =
  /\b(i\s*(?:will|'ll)\s*respond\s*properly\s*(?:in|by)?\s*(?:the\s*)?morning|respond\s*properly\s*(?:in|by)?\s*(?:the\s*)?morning)\b/i;

function normalizeSingleLine(text: string) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildNightWindDownFallback(resumeLabel?: string) {
  if (resumeLabel) {
    return `I'm winding down for tonight, but this matters to me. I'll send a proper reply after ${resumeLabel}.`;
  }
  return "I'm winding down for tonight, but this matters to me. I'll send a proper reply tomorrow morning.";
}

export function enforceNightWindDownStyle(args: {
  text: string;
  resumeLabel?: string;
}) {
  const violations: string[] = [];
  const fallback = buildNightWindDownFallback(args.resumeLabel);
  const normalized = normalizeSingleLine(args.text);

  if (!normalized) {
    return {
      text: fallback,
      violations: ["empty_text"],
    };
  }

  let next = normalized;

  if (ROBOTIC_CUE_PATTERN.test(next)) {
    violations.push("robotic_or_internal_cue");
    next = fallback;
  }

  if (AWKWARD_MORNING_PHRASE_PATTERN.test(next)) {
    violations.push("awkward_morning_phrase");
    next = next.replace(
      AWKWARD_MORNING_PHRASE_PATTERN,
      "I want to give this a proper reply tomorrow morning",
    );
  }

  if (/\?/.test(next)) {
    violations.push("question_removed");
    next = next.replace(/\?/g, ".");
  }

  next = normalizeSingleLine(next);

  if (next.length > 180) {
    violations.push("too_long");
    next = fallback;
  }

  if (!/[.!]$/.test(next)) {
    next = `${next}.`;
  }

  return {
    text: next,
    violations,
  };
}
