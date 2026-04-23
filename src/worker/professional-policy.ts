export type ProfessionalPolicyDecision = {
  forceDeterministicProfessional: boolean;
  reason: string;
};

const PROFESSIONAL_CUE_PATTERN =
  /\b(invoice|contract|proposal|deck|deadline|deliverable|scope|client|meeting|follow-up|follow up|eta|timeline|budget|approval|next steps|action items)\b/i;

function parseHistoryLine(line: string) {
  const idx = line.indexOf(":");
  if (idx < 0) {
    return line.trim();
  }
  return line.slice(idx + 1).trim();
}

export function decideProfessionalPolicy(args: { inboundText: string; historyLines: string[]; profileSlug?: string }): ProfessionalPolicyDecision {
  const inbound = (args.inboundText || "").trim();
  const slug = (args.profileSlug || "").trim().toLowerCase();
  const profileProfessional = slug === "professional";
  const historyProfessional = args.historyLines.slice(-10).some((line) => PROFESSIONAL_CUE_PATTERN.test(parseHistoryLine(line)));
  const inboundProfessional = PROFESSIONAL_CUE_PATTERN.test(inbound);

  const forceDeterministicProfessional = profileProfessional && (inboundProfessional || historyProfessional);
  return {
    forceDeterministicProfessional,
    reason: forceDeterministicProfessional ? "professional_structured_response" : "professional_none",
  };
}

export function buildDeterministicProfessionalReply(inboundText: string) {
  const inbound = (inboundText || "").trim();
  const asksEta = /\b(eta|when|timeline|deadline|by when)\b/i.test(inbound);
  const asksInvoice = /\b(invoice|payment|bill)\b/i.test(inbound);
  const asksMeeting = /\b(meeting|call|sync|follow-up|follow up)\b/i.test(inbound);

  if (asksInvoice) {
    return "Noted. I will send the invoice update shortly with exact line items and status.";
  }
  if (asksMeeting) {
    return "Understood. Proposed next step: confirm a 20-minute slot, then I will send an agenda and owners.";
  }
  if (asksEta) {
    return "Understood. Current ETA is being finalized; I will return with a concrete timestamp and owner.";
  }
  return "Understood. Next step: I will send a concise update with owner, timeline, and any blocker.";
}
