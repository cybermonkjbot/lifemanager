import { hasPidginCasualSignal } from "../../shared/pidgin-lexicon";

export type MemePolicyMode = "auto" | "always_allow" | "always_block";

export type ConversationMessageSignal = {
  text: string;
  direction?: "inbound" | "outbound";
  messageType?: string;
};

export type ProfessionalConversationAssessment = {
  isProfessional: boolean;
  score: number;
  businessHits: number;
  playfulHits: number;
  signals: string[];
};

const BUSINESS_PATTERNS = [
  /\b(meeting|agenda|minutes|action items?)\b/i,
  /\b(invoice|invoicing|payment|remittance|receipt)\b/i,
  /\b(client|customer|vendor|stakeholder)\b/i,
  /\b(proposal|quotation|quote|rfq|scope)\b/i,
  /\b(contract|nda|compliance|audit|legal|policy)\b/i,
  /\b(deadline|deliverable|milestone|timeline)\b/i,
  /\b(project|sprint|roadmap|backlog)\b/i,
  /\b(approval|approved|sign-?off|review)\b/i,
  /\b(interview|candidate|hiring|recruit)\b/i,
  /\b(follow up|follow-up|circle back)\b/i,
];

const FORMAL_PATTERNS = [/\b(please|kindly|regards|thank you)\b/i, /\b(as discussed|per our|fyi)\b/i];

const PLAYFUL_PATTERNS = [
  /\b(lol|lmao|lmfao|rofl|haha|hehe|banter|joke|meme|roast|funny|goofy)\b/i,
  /\b(bro|bestie|fr|ngl|tbh|vibes?)\b/i,
];

const PLAYFUL_EMOJI_PATTERN = /[😂🤣😹😆😄😁😅😜🤪🙃🔥💀]/u;

const SERIOUS_PATTERNS = [
  /\b(password|otp|bank|wire|transfer|fraud|security)\b/i,
  /\b(hospital|surgery|diagnosis|cancer|emergency|accident)\b/i,
  /\b(lawsuit|court|lawyer|legal)\b/i,
];

function countPatternHits(text: string, patterns: RegExp[]) {
  let hits = 0;
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      hits += 1;
    }
  }
  return hits;
}

function normalizeScore(value: number) {
  return Math.max(-4, Math.min(value, 10));
}

export function isSeriousConversationText(text: string) {
  if (!text.trim()) {
    return false;
  }
  return countPatternHits(text, SERIOUS_PATTERNS) > 0;
}

export function assessProfessionalConversation(args: {
  messages: ConversationMessageSignal[];
  latestInboundText?: string;
}): ProfessionalConversationAssessment {
  const recent = args.messages.slice(-36);
  let score = 0;
  let businessHits = 0;
  let playfulHits = 0;
  let formalHits = 0;
  let seriousHits = 0;

  for (const message of recent) {
    const text = (message.text || "").trim();
    if (!text) {
      continue;
    }
    const business = countPatternHits(text, BUSINESS_PATTERNS);
    const formal = countPatternHits(text, FORMAL_PATTERNS);
    const playful =
      countPatternHits(text, PLAYFUL_PATTERNS) + (PLAYFUL_EMOJI_PATTERN.test(text) ? 1 : 0) + (hasPidginCasualSignal(text) ? 1 : 0);
    const serious = isSeriousConversationText(text) ? 1 : 0;

    businessHits += business;
    formalHits += formal;
    playfulHits += playful;
    seriousHits += serious;

    score += business * 1.1 + formal * 0.45 + serious * 0.2;
    score -= playful * 0.9;
  }

  const latest = (args.latestInboundText || "").trim();
  if (latest) {
    const latestBusiness = countPatternHits(latest, BUSINESS_PATTERNS);
    const latestFormal = countPatternHits(latest, FORMAL_PATTERNS);
    const latestPlayful =
      countPatternHits(latest, PLAYFUL_PATTERNS) +
      (PLAYFUL_EMOJI_PATTERN.test(latest) ? 1 : 0) +
      (hasPidginCasualSignal(latest) ? 1 : 0);

    businessHits += latestBusiness;
    formalHits += latestFormal;
    playfulHits += latestPlayful;

    score += latestBusiness * 1.4 + latestFormal * 0.6;
    score -= latestPlayful * 1.1;
  }

  const normalizedScore = normalizeScore(score);
  const isProfessional =
    (businessHits >= 2 && normalizedScore >= 2.4 && businessHits >= playfulHits) ||
    (businessHits >= 4 && normalizedScore >= 1.8 && playfulHits <= businessHits + 1);

  const signals: string[] = [];
  if (businessHits > 0) {
    signals.push(`business:${businessHits}`);
  }
  if (formalHits > 0) {
    signals.push(`formal:${formalHits}`);
  }
  if (playfulHits > 0) {
    signals.push(`playful:${playfulHits}`);
  }
  if (seriousHits > 0) {
    signals.push(`serious:${seriousHits}`);
  }

  return {
    isProfessional,
    score: Number(normalizedScore.toFixed(2)),
    businessHits,
    playfulHits,
    signals,
  };
}
