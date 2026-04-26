export type RelationshipState = {
  trustScore: number;
  warmthTrend: -1 | 0 | 1;
  conflictFlag: boolean;
  responsivenessMismatch: boolean;
  repairNeeded: boolean;
};

export type RelationshipPolicyDecision = {
  state: RelationshipState;
  allowHumor: boolean;
  forceDeterministicRepair: boolean;
  prioritizeRomanticCare: boolean;
  emotionFirstRepair: boolean;
  reason: string;
};

const PASSIVE_AGGRESSIVE_PATTERN =
  /\b(no worry|no wahala|no stress)\b.*\b(enjoy|continue|carry on|do your thing)\b|\bfine then\b|\bokay then\b|\bdo your thing\b|\bthat'?s fine then\b|\bforget it\b|\bit'?s whatever\b/i;
const ACCUSATION_PATTERN =
  /\b(you ignored me|you forgot me|you don'?t care|you do not care|you were seen|why (?:didn'?t|no) (?:you )?(?:pick|answer|reply)|left me on read|left me hanging|where were you|who were you chatting with|who (?:were|you) with|you aired me|you ghosted me|you disappeared|you blanked me)\b/i;
const HURT_PATTERN =
  /\b(i(?:'|’)m hurt|that hurt|you hurt me|i feel (?:disrespected|ignored|stupid|small|bad)|you embarrassed me|that was cold|that felt cold|you made me feel stupid)\b/i;
const LOGIC_BACKFIRE_PATTERN =
  /\b(stop explaining|you(?:'|’)re explaining|you are explaining|always explaining|too logical|you(?:'|’)re too logical|you are too logical|you don'?t get it|you do not get it|you never understand|you(?:'|’)re not listening|you are not listening|you(?:'|’)re being defensive|you are being defensive|making excuses|just admit|you always defend yourself|you keep defending yourself)\b/i;
const REPAIR_SIGNAL_PATTERN = /\b(sorry|apolog(?:y|ize|ise)|my bad|i get you|i hear you|i understand|you'?re right|you are right)\b/i;
const PLAYFUL_PATTERN = /\b(lol|lmao|haha|banter|joke|funny)\b|[😂🤣😅]/i;
const WARM_PATTERN = /\b(miss you|love|care|appreciate|thank you|sweet|dear|babe)\b/i;
const ROMANTIC_CUE_PATTERN =
  /\b(babe|baby|my love|sweetheart|darling|girlfriend|boyfriend|relationship|us two|date night|kiss|hug)\b/i;

function clamp01(value: number) {
  return Math.max(0, Math.min(value, 1));
}

function parseHistoryLine(line: string) {
  const idx = line.indexOf(":");
  if (idx < 0) {
    return { speaker: "other", body: line.trim() };
  }
  const speaker = line.slice(0, idx).trim().toLowerCase();
  const body = line.slice(idx + 1).trim();
  return { speaker, body };
}

export function deriveRelationshipState(args: { inboundText: string; historyLines: string[] }): RelationshipState {
  const inbound = (args.inboundText || "").trim();
  const recent = (args.historyLines || []).slice(-24).map(parseHistoryLine);

  let warmthSignals = 0;
  let conflictSignals = 0;
  let inboundCount = 0;
  let outboundCount = 0;

  for (const line of recent) {
    const body = line.body;
    if (!body) {
      continue;
    }
    if (line.speaker === "them") {
      inboundCount += 1;
    }
    if (line.speaker === "me") {
      outboundCount += 1;
    }
    if (WARM_PATTERN.test(body)) {
      warmthSignals += 1;
    }
    if (PASSIVE_AGGRESSIVE_PATTERN.test(body) || ACCUSATION_PATTERN.test(body) || HURT_PATTERN.test(body)) {
      conflictSignals += 1;
    }
  }

  if (WARM_PATTERN.test(inbound)) {
    warmthSignals += 1;
  }
  if (PASSIVE_AGGRESSIVE_PATTERN.test(inbound) || ACCUSATION_PATTERN.test(inbound) || HURT_PATTERN.test(inbound)) {
    conflictSignals += 2;
  }

  const responsivenessMismatch = inboundCount - outboundCount >= 4;
  const trustScore = clamp01(0.62 + warmthSignals * 0.05 - conflictSignals * 0.12 - (responsivenessMismatch ? 0.1 : 0));
  const warmthTrend: -1 | 0 | 1 = warmthSignals > conflictSignals ? 1 : conflictSignals > warmthSignals ? -1 : 0;
  const conflictFlag = conflictSignals > 0;
  const repairNeeded = conflictFlag || responsivenessMismatch;

  return {
    trustScore,
    warmthTrend,
    conflictFlag,
    responsivenessMismatch,
    repairNeeded,
  };
}

function extractConcreteAsk(inboundText: string) {
  const text = (inboundText || "").trim();
  if (!text) {
    return "";
  }
  if (/\?$/.test(text) || /\b(why|when|where|what|who|how|did|can|will)\b/i.test(text)) {
    return "I hear you. Let me answer directly now.";
  }
  return "I hear you. I will keep this clear and direct.";
}

function buildEmotionFirstRepairReply(args: {
  inboundText: string;
  state: RelationshipState;
  prioritizeRomanticCare?: boolean;
}) {
  const inbound = (args.inboundText || "").trim();
  const romanticPrefix = args.prioritizeRomanticCare ? "I care about us, and " : "";
  const accountableClose = "I will slow down, listen first, and explain only after I have understood you.";

  if (HURT_PATTERN.test(inbound)) {
    return `${romanticPrefix}I hear that I hurt you. I do not want to argue you out of that feeling. ${accountableClose}`;
  }
  if (ACCUSATION_PATTERN.test(inbound)) {
    return `${romanticPrefix}I get why that felt like I was not showing up for you. I am not trying to dismiss it. ${accountableClose}`;
  }
  if (PASSIVE_AGGRESSIVE_PATTERN.test(inbound)) {
    return `${romanticPrefix}I hear the frustration under that. I will not turn this into a debate; ${accountableClose.charAt(0).toLowerCase()}${accountableClose.slice(1)}`;
  }
  if (LOGIC_BACKFIRE_PATTERN.test(inbound)) {
    return `${romanticPrefix}you are right that explaining first can make it feel like I am not listening. I will slow down and understand you before I try to explain my side.`;
  }
  if (args.state.responsivenessMismatch) {
    return `${romanticPrefix}you are right that my responsiveness has been off. I know that can feel careless, and I will fix the pattern instead of explaining it away.`;
  }
  return `${romanticPrefix}I hear you. I will listen first and keep my explanation calm and clear.`;
}

export function buildDeterministicRepairReply(args: {
  inboundText: string;
  state: RelationshipState;
  prioritizeRomanticCare?: boolean;
}) {
  const inbound = (args.inboundText || "").trim();
  if (args.prioritizeRomanticCare) {
    return buildEmotionFirstRepairReply(args);
  }

  const directAnswer = extractConcreteAsk(inbound);
  const romanticPrefix = args.prioritizeRomanticCare
    ? "I care about us, and I hear you. "
    : "";

  if (HURT_PATTERN.test(inbound)) {
    return `${romanticPrefix}You are right to call this out. I hear you, and I will handle this better from here.`;
  }
  if (ACCUSATION_PATTERN.test(inbound)) {
    return `${romanticPrefix}I hear you, and I get why you are upset. ${directAnswer}`;
  }
  if (PASSIVE_AGGRESSIVE_PATTERN.test(inbound)) {
    return `${romanticPrefix}I hear the frustration. ${directAnswer}`;
  }
  if (args.state.responsivenessMismatch) {
    return `${romanticPrefix}You are right, my responsiveness has been off. I hear you and I will fix that pattern.`;
  }
  return `${romanticPrefix}I hear you. ${directAnswer}`;
}

export function decideRelationshipPolicy(args: {
  inboundText: string;
  historyLines: string[];
  profileSlug?: string;
}): RelationshipPolicyDecision {
  const state = deriveRelationshipState(args);
  const inbound = (args.inboundText || "").trim();
  const hasConflictCue = PASSIVE_AGGRESSIVE_PATTERN.test(inbound) || ACCUSATION_PATTERN.test(inbound) || HURT_PATTERN.test(inbound);
  const hasLogicBackfireCue = LOGIC_BACKFIRE_PATTERN.test(inbound);
  const hasRepairSignal = REPAIR_SIGNAL_PATTERN.test(inbound);
  const playful = PLAYFUL_PATTERN.test(inbound);
  const slug = (args.profileSlug || "").trim().toLowerCase();
  const romanticProfile = slug === "girlfriend" || slug === "relationship";
  const romanticCue =
    romanticProfile ||
    ROMANTIC_CUE_PATTERN.test(inbound) ||
    args.historyLines.slice(-12).some((line) => ROMANTIC_CUE_PATTERN.test(parseHistoryLine(line).body));
  const prioritizeRomanticCare = romanticCue;

  const emotionFirstRepair = prioritizeRomanticCare && (hasConflictCue || hasLogicBackfireCue || state.repairNeeded);
  const forceDeterministicRepair = hasConflictCue || hasLogicBackfireCue || (state.repairNeeded && (!hasRepairSignal || prioritizeRomanticCare));
  const allowHumor = !forceDeterministicRepair && playful && state.trustScore >= 0.55 && !state.conflictFlag;
  const reason = forceDeterministicRepair
    ? prioritizeRomanticCare
      ? "romantic_conflict_repair"
      : "relationship_conflict_repair"
    : allowHumor
      ? prioritizeRomanticCare
        ? "romantic_playful_safe"
        : "relationship_playful_safe"
      : prioritizeRomanticCare
        ? "romantic_neutral"
        : "relationship_neutral";

  return {
    state,
    allowHumor,
    forceDeterministicRepair,
    prioritizeRomanticCare,
    emotionFirstRepair,
    reason,
  };
}
