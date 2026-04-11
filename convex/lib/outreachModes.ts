export type OutreachMode = "proactive" | "good_morning" | "compliment";

export const PROACTIVE_OUTREACH_REASON_PREFIX = "Proactive check-in outreach";
export const GOOD_MORNING_OUTREACH_REASON_PREFIX = "Adaptive good morning protocol";
export const COMPLIMENT_OUTREACH_REASON_PREFIX = "Random appreciation outreach";

export function deriveOutreachModeFromReason(reason?: string | null): OutreachMode | undefined {
  const normalized = (reason || "").trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.startsWith(GOOD_MORNING_OUTREACH_REASON_PREFIX)) {
    return "good_morning";
  }
  if (normalized.startsWith(PROACTIVE_OUTREACH_REASON_PREFIX)) {
    return "proactive";
  }
  if (normalized.startsWith(COMPLIMENT_OUTREACH_REASON_PREFIX)) {
    return "compliment";
  }
  return undefined;
}

export function isConversationStarterReason(reason?: string | null) {
  return Boolean(deriveOutreachModeFromReason(reason));
}
