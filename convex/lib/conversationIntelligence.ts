import type { Doc } from "../_generated/dataModel";

export type ConversationSignalType =
  | "checkin_prompt"
  | "checkin_response"
  | "topic_start"
  | "topic_continue"
  | "topic_close"
  | "topic_pivot";

export type CheckInSignalType = Extract<ConversationSignalType, "checkin_prompt" | "checkin_response">;
export type CheckInDetection = {
  signalType: CheckInSignalType;
  confidence: number;
  reason: string;
};
export type TopicResolutionSource = "pattern" | "lane_overlap" | "lane_continuity" | "fallback_general";
export type TopicDetection = {
  topicKey: string;
  topicLabel: string;
  confidence: number;
  source: TopicResolutionSource;
};
export type TopicLaneHint = {
  topicKey: string;
  topicLabel: string;
  status?: "active" | "cooling" | "closed";
  lastMessageAt?: number;
};
export type LeadPivotSafetyInput = {
  conversationIntelligenceEnabled: boolean;
  pivotReplyEnabled: boolean;
  topicLeadPivotEnabled: boolean;
  shouldClose: boolean;
  conflictCue: boolean;
  pauseCue: boolean;
  leadCooldownActive: boolean;
  topicDwellScore: number;
  vibeScore: number;
  minVibeScore: number;
  laneExhausted: boolean;
  explicitAskCue: boolean;
  unansweredOutboundStreak: number;
  maxUnansweredOutboundStreak?: number;
  styleMatrixRisk?: string;
  styleMatrixConfidence?: number;
  recentIgnoredOrFailedProactive?: boolean;
};
export type LeadPivotSafetyResult = {
  eligible: boolean;
  reasonCodes: string[];
};

export const MUTUAL_CHECKIN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const GENERAL_TOPIC_KEY = "general";
export const GENERAL_TOPIC_LABEL = "General chat";
export const TOPIC_CLOSE_PATTERNS: RegExp[] = [
  /\b(bye|good ?night|good ?nite|gud ?night|gud ?nite|gnight|night night|sweet dreams|sleep well|rest well|have (?:a )?(?:good|great|lovely|nice) night|about to sleep|going to sleep|off to bed|heading to bed|later|talk later|talk tom+or+ow|chat tom+or+ow|speak tom+or+ow|catch(?:\s+up)? tom+or+ow|continue tom+or+ow|tmrw?|ttyl|that(?:'s| is) all(?: for now)?|na all|we good|close this|end this|stop here)\b/i,
  /\b(gudnyt|goodnightt+|night night|nighty night|sweet dreams?|sleep (?:well|tight)|rest well|rest up|have (?:a )?(?:good|great|lovely|nice|peaceful) (?:night|evening)|go(?:ing)? bed|bedtime|sleep calls|i (?:need|wan|wanna|want) (?:to )?sleep|i(?:'|’)?m sleeping|i(?:'|’)?m off|i(?:'|’)?m going off|let me sleep|make i sleep)\b/i,
  /\b((?:can|could|shall)\s+we\s+|let(?:'|’)?s\s+|we(?:'|’)?ll\s+|we\s+will\s+)?(talk|speak|chat|catch(?:\s+up)?|continue|yarn|gist|resume|pick\s+this\s+up)\s+(?:to\s+you\s+|again\s+|more\s+|properly\s+)?(?:tom+or+ow|tmrw?|tmr|tomoz|in\s+the\s+morning|later)\b/i,
  /\b(i(?:'|’)?ll|i will|we(?:'|’)?ll|we will|let(?:'|’)?s|make i|make we)\s+(?:text|message|msg|call|ring|ping|dm|holla|buzz|talk|speak|chat|continue|yarn|gist|resume)\s+(?:you\s+|again\s+|properly\s+)?(?:tom+or+ow|tmrw?|tmr|tomoz|in\s+the\s+morning|later)\b/i,
  /\b(see (?:you|u|ya)|cya|catch (?:you|u|ya)|talk to (?:you|u)|speak to (?:you|u)|chat to (?:you|u))\s+(?:tom+or+ow|tmrw?|tmr|tomoz|in\s+the\s+morning|later)\b/i,
  /^(?:gn+|g9|nyt|nite|night|goodnight|good night|sleep well|sweet dreams?|rest well|rest up)[.!?~\s]*$/i,
  /^(?:okay\s+|ok\s+|kk\s+|alright\s+|sounds good\s+|cool\s+|sure\s+|bet\s+|then\s+)?(?:tom+or+ow|tmrw?|tmr|tomoz|morning)(?:\s+(?:then|it is|works|sounds good|by god'?s grace|lord willing))?[.!?~\s]*$/i,
];

const CHECKIN_PROMPT_PATTERNS: RegExp[] = [
  /\bhow (are|r) (you|u)\b/i,
  /\bhow(?:'|’)s (?:your )?(?:day|mind|heart|body|week)\b/i,
  /\bhow you dey\b/i,
  /\bhow body\b/i,
  /\bhow body now\b/i,
  /\bhow far\b/i,
  /\b(are|r) (you|u) (good|okay|ok|alright|fine)\b/i,
  /\b(you|u) (good|okay|ok|alright|fine)\??\b/i,
  /\b(?:is )?(?:everything|everytin|everythin)(?:'|’)?s?(?: still)? (?:okay|ok|fine|alright|good|settled|well)\b/i,
  /\b(?:all|everything|everytin|everythin)(?:'|’)?s? (?:still )?(?:okay|ok|fine|alright|good|settled|well) (?:on )?(?:your|ur) (?:side|end)\b/i,
  /\bhope (?:say )?(?:(?:your|ur) (?:side|end)) (?:is |dey )?(?:settled|okay|ok|fine|alright|good|well)\b/i,
  /\b(?:is )?(?:your|ur) (?:side|end) (?:is |dey )?(?:settled|okay|ok|fine|alright|good|well)\b/i,
  /\bhope (?:say )?(?:everything|everytin|everythin|all) (?:is |dey )?(?:settled|okay|ok|fine|alright|good|well)\b/i,
  /\bchecking in( on you)?\b/i,
  /\bchecking on you\b/i,
  /\bhope (?:say )?(you|u) (?:are|dey|feel(?:ing)?|(?:'|’)re) (okay|ok|fine|alright|good|well)\b/i,
  /\bhope (you|u)(?:'|’)re holding up\b/i,
  /\b(you|u)(?:'|’)?ve been quiet\b/i,
  /\bjust checking\b/i,
  /\byou dey (okay|ok|alright|fine|good|well)\b/i,
];

const CHECKIN_RESPONSE_PATTERNS: RegExp[] = [
  /\b(i('| a)?m|im) (good|fine|okay|ok|alright|hanging in there|holding up)\b/i,
  /\bi dey (good|fine|okay|ok|alright|manage)\b/i,
  /\b(all good|all okay|all ok)\b/i,
  /\b(we dey|dey okay|dey ok|dey fine|we move|managing)\b/i,
];

const CHECKIN_PROMPT_AMBIGUOUS_PATTERNS: RegExp[] = [
  /\bhow far (is|are|from|to|along|away|can|will)\b/i,
  /\bhow far gone\b/i,
];

const TRACKABLE_MESSAGE_TYPES = new Set<
  Exclude<Doc<"messages">["messageType"], "reaction" | "sticker" | undefined>
>(["text", "meme", "image", "video", "audio", "document"]);
const TOPIC_RESOLUTION_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "for",
  "from",
  "have",
  "i",
  "im",
  "in",
  "is",
  "it",
  "its",
  "just",
  "me",
  "my",
  "of",
  "on",
  "or",
  "so",
  "that",
  "the",
  "this",
  "to",
  "we",
  "you",
  "your",
]);
const SHORT_ACK_PATTERN = /^(ok(?:ay)?|k+|cool|nice|great|sure|alright|true|yes|yeah|yep|nope?|nah|noted|seen|copy|safe|sharp|bet+)[.!?]*$/i;
const CONTINUITY_CONNECTOR_PATTERN =
  /\b(still|also|again|about that|regarding|same|update|tomorrow|today|later|tonight|this one|that one|it|that|this)\b/i;
const TOPIC_HINT_TERMS: Record<string, string[]> = {
  wellbeing: ["health", "sick", "recovery", "sleep", "body", "wellbeing", "energy", "rest"],
  plans: ["plan", "tomorrow", "today", "weekend", "schedule", "trip", "meeting", "hangout", "travel"],
  work_admin: ["client", "deadline", "task", "project", "proposal", "ticket", "deliverable", "kpi"],
  finances: ["money", "payment", "transfer", "salary", "budget", "debt", "loan", "invoice", "cash"],
  family: ["mom", "mum", "mother", "dad", "father", "sister", "brother", "family", "aunt", "uncle"],
  logistics: ["address", "location", "arrive", "pickup", "dropoff", "route", "traffic", "distance"],
  repair: ["sorry", "apology", "hurt", "harsh", "misunderstood", "conflict", "repair"],
  celebration: ["congrats", "promotion", "offer", "passed", "won", "celebrate", "proud"],
  advice: ["advice", "recommend", "guide", "mentor", "feedback", "review", "teach"],
  grief_support: ["grief", "loss", "funeral", "died", "passed away", "rough day", "overwhelmed"],
  romance_reassurance: ["miss", "love", "babe", "baby", "relationship", "reassure", "romantic"],
  group_moderation: ["group", "everyone", "guys", "community", "team chat", "confirm attendance"],
  service_complaint: ["refund", "receipt", "delivery", "vendor", "complaint", "order", "service"],
  media_reaction: ["photo", "video", "image", "sticker", "meme", "voice note", "status"],
};
const TOPIC_PATTERN_CATALOG: Array<{
  topicKey: string;
  topicLabel: string;
  patterns: RegExp[];
}> = [
  {
    topicKey: "wellbeing",
    topicLabel: "Wellbeing",
    patterns: [
      /\b(how are you|how you dey|how body|hope you (are|dey)|health|sick|hospital|recover|rest|sleep)\b/i,
    ],
  },
  {
    topicKey: "plans",
    topicLabel: "Plans",
    patterns: [
      /\b(plan|tomorrow|today|weekend|schedule|arrange|meeting|hangout|trip|travel|later today)\b/i,
    ],
  },
  {
    topicKey: "work_admin",
    topicLabel: "Work/Admin",
    patterns: [
      /\b(client|deadline|task|project|deliverable|ticket|proposal|meeting note|follow up|kpi)\b/i,
    ],
  },
  {
    topicKey: "finances",
    topicLabel: "Finances",
    patterns: [
      /\b(money|payment|transfer|salary|budget|debt|loan|invoice|owe|cash)\b/i,
    ],
  },
  {
    topicKey: "family",
    topicLabel: "Family",
    patterns: [
      /\b(mom|mum|mother|dad|father|sister|brother|family|aunt|uncle|cousin)\b/i,
    ],
  },
  {
    topicKey: "logistics",
    topicLabel: "Logistics",
    patterns: [
      /\b(where|address|location|arrive|pickup|pick up|drop off|route|traffic|distance|come over)\b/i,
    ],
  },
  {
    topicKey: "repair",
    topicLabel: "Apology/Repair",
    patterns: [/\b(sorry|apolog(?:y|ize)|my bad|hurt|harsh|misunderstood|conflict|make it right)\b/i],
  },
  {
    topicKey: "celebration",
    topicLabel: "Celebration",
    patterns: [/\b(congrats|congratulations|promotion|offer|passed|won|proud|celebrate)\b/i],
  },
  {
    topicKey: "advice",
    topicLabel: "Advice/Mentorship",
    patterns: [/\b(advice|advise|recommend|guide|mentor|feedback|review my|teach me|what should i do)\b/i],
  },
  {
    topicKey: "grief_support",
    topicLabel: "Grief/Support",
    patterns: [/\b(grief|loss|funeral|passed away|died|rough day|drained|overwhelmed)\b/i],
  },
  {
    topicKey: "romance_reassurance",
    topicLabel: "Romance/Reassurance",
    patterns: [/\b(miss you|love you|babe|baby|relationship|reassure|date|romantic)\b/i],
  },
  {
    topicKey: "group_moderation",
    topicLabel: "Group/Community",
    patterns: [/\b(group chat|everyone|guys|community|team chat|who is coming|confirm attendance)\b/i],
  },
  {
    topicKey: "service_complaint",
    topicLabel: "Service Complaint",
    patterns: [/\b(refund|receipt|delivery|vendor|complaint|order|service issue|not delivered)\b/i],
  },
  {
    topicKey: "media_reaction",
    topicLabel: "Media Reaction",
    patterns: [/\b(photo|video|image|sticker|meme|voice note|status|story)\b/i],
  },
];

export function normalizeConversationText(raw: string) {
  return raw
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function tokenizeTopicTerms(text: string) {
  const normalized = normalizeConversationText(text).replace(/[^a-z0-9\s]/g, " ");
  return normalized
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !TOPIC_RESOLUTION_STOPWORDS.has(word));
}

function scoreTokenOverlap(tokens: string[], terms: string[]) {
  if (tokens.length === 0 || terms.length === 0) {
    return 0;
  }
  const tokenSet = new Set(tokens);
  const dedupedTerms = [...new Set(terms)];
  let hits = 0;
  for (const term of dedupedTerms) {
    if (tokenSet.has(term)) {
      hits += 1;
    }
  }
  return hits / Math.max(1, dedupedTerms.length);
}

function makeTopicLabel(topicKey: string) {
  const catalog = TOPIC_PATTERN_CATALOG.find((candidate) => candidate.topicKey === topicKey);
  if (catalog?.topicLabel) {
    return catalog.topicLabel;
  }
  return topicKey
    .split(/[_\s]+/)
    .map((part) => (part ? `${part[0]?.toUpperCase() || ""}${part.slice(1)}` : ""))
    .join(" ")
    .trim();
}

function dedupeLaneHints(laneHints: TopicLaneHint[]) {
  const bestByTopicKey = new Map<string, TopicLaneHint>();
  const rankStatus = (status: TopicLaneHint["status"]) => {
    if (status === "active") return 3;
    if (status === "cooling") return 2;
    if (status === "closed") return 1;
    return 0;
  };
  for (const lane of laneHints) {
    const current = bestByTopicKey.get(lane.topicKey);
    if (!current) {
      bestByTopicKey.set(lane.topicKey, lane);
      continue;
    }
    const laneRank = rankStatus(lane.status);
    const currentRank = rankStatus(current.status);
    if (laneRank > currentRank || (laneRank === currentRank && (lane.lastMessageAt || 0) > (current.lastMessageAt || 0))) {
      bestByTopicKey.set(lane.topicKey, lane);
    }
  }
  return [...bestByTopicKey.values()];
}

function hasContinuityCue(normalizedText: string) {
  if (!normalizedText) {
    return false;
  }
  if (SHORT_ACK_PATTERN.test(normalizedText)) {
    return true;
  }
  if (CONTINUITY_CONNECTOR_PATTERN.test(normalizedText)) {
    return true;
  }
  return false;
}

export function detectCheckInSignal(text: string): CheckInDetection | null {
  const normalized = normalizeConversationText(text);
  if (!normalized) {
    return null;
  }

  const hasQuestionCue = normalized.includes("?") || /\bhow\b|\bhope\b|\bchecking in\b/i.test(normalized);

  for (const pattern of CHECKIN_PROMPT_AMBIGUOUS_PATTERNS) {
    if (pattern.test(normalized)) {
      return null;
    }
  }

  for (const pattern of CHECKIN_PROMPT_PATTERNS) {
    if (pattern.test(normalized)) {
      const confidence = /\bhow far\b/i.test(normalized)
        ? hasQuestionCue
          ? 0.74
          : 0.58
        : hasQuestionCue
          ? 0.88
          : 0.8;
      return {
        signalType: "checkin_prompt",
        confidence,
        reason: "prompt_pattern_match",
      };
    }
  }

  for (const pattern of CHECKIN_RESPONSE_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        signalType: "checkin_response",
        confidence: 0.83,
        reason: "response_pattern_match",
      };
    }
  }

  return null;
}

export function detectCheckInSignalType(text: string): CheckInSignalType | null {
  const detected = detectCheckInSignal(text);
  return detected?.signalType || null;
}

export function inferTopicFromText(text: string): TopicDetection {
  const normalized = normalizeConversationText(text);
  if (!normalized) {
    return {
      topicKey: GENERAL_TOPIC_KEY,
      topicLabel: GENERAL_TOPIC_LABEL,
      confidence: 0.25,
      source: "fallback_general",
    };
  }

  for (const candidate of TOPIC_PATTERN_CATALOG) {
    if (candidate.patterns.some((pattern) => pattern.test(normalized))) {
      return {
        topicKey: candidate.topicKey,
        topicLabel: candidate.topicLabel,
        confidence: 0.76,
        source: "pattern",
      };
    }
  }

  return {
    topicKey: GENERAL_TOPIC_KEY,
    topicLabel: GENERAL_TOPIC_LABEL,
    confidence: 0.32,
    source: "fallback_general",
  };
}

export function resolveTopicFromText(args: {
  text: string;
  currentPrimaryTopicKey?: string;
  laneHints?: TopicLaneHint[];
}): TopicDetection {
  const inferred = inferTopicFromText(args.text);
  if (inferred.topicKey !== GENERAL_TOPIC_KEY) {
    return inferred;
  }
  if (hasTopicCloseCue(args.text)) {
    return inferred;
  }

  const normalized = normalizeConversationText(args.text);
  const tokens = tokenizeTopicTerms(normalized);
  const continuityCue = hasContinuityCue(normalized);
  const currentPrimaryTopicKey =
    args.currentPrimaryTopicKey && args.currentPrimaryTopicKey !== GENERAL_TOPIC_KEY
      ? args.currentPrimaryTopicKey
      : undefined;

  const laneHints = dedupeLaneHints(
    (args.laneHints || []).filter(
      (lane) => Boolean(lane.topicKey) && lane.topicKey !== GENERAL_TOPIC_KEY && lane.status !== "closed",
    ),
  );
  if (laneHints.length === 0) {
    if (currentPrimaryTopicKey && continuityCue) {
      return {
        topicKey: currentPrimaryTopicKey,
        topicLabel: makeTopicLabel(currentPrimaryTopicKey),
        confidence: 0.52,
        source: "lane_continuity",
      };
    }
    return inferred;
  }

  const newestLaneMessageAt = laneHints.reduce((acc, lane) => Math.max(acc, lane.lastMessageAt || 0), 0);
  const scored = laneHints
    .map((lane) => {
      const labelTerms = tokenizeTopicTerms((lane.topicLabel || "").replace(/\//g, " "));
      const hintTerms = TOPIC_HINT_TERMS[lane.topicKey] || [];
      const overlapScore = Math.max(scoreTokenOverlap(tokens, labelTerms), scoreTokenOverlap(tokens, hintTerms));
      const statusBoost = lane.status === "active" ? 0.17 : lane.status === "cooling" ? 0.09 : 0;
      const continuityBoost = lane.topicKey === currentPrimaryTopicKey && continuityCue ? 0.22 : 0;
      const recencyBoost =
        newestLaneMessageAt > 0 && lane.lastMessageAt
          ? clamp01(lane.lastMessageAt / newestLaneMessageAt) * 0.1
          : 0;
      const score = overlapScore * 0.64 + statusBoost + continuityBoost + recencyBoost;
      return {
        lane,
        overlapScore,
        score,
      };
    })
    .sort((left, right) => right.score - left.score);
  const best = scored[0];

  if (best && (best.score >= 0.42 || (continuityCue && best.score >= 0.28) || best.overlapScore >= 0.35)) {
    return {
      topicKey: best.lane.topicKey,
      topicLabel: best.lane.topicLabel || makeTopicLabel(best.lane.topicKey),
      confidence: clamp01(0.44 + best.score * 0.46),
      source: "lane_overlap",
    };
  }

  if (currentPrimaryTopicKey && continuityCue) {
    const currentLane = laneHints.find((lane) => lane.topicKey === currentPrimaryTopicKey);
    return {
      topicKey: currentPrimaryTopicKey,
      topicLabel: currentLane?.topicLabel || makeTopicLabel(currentPrimaryTopicKey),
      confidence: 0.5,
      source: "lane_continuity",
    };
  }

  return inferred;
}

export function evaluateLeadPivotSafety(args: LeadPivotSafetyInput): LeadPivotSafetyResult {
  const reasonCodes: string[] = [];
  if (!args.conversationIntelligenceEnabled || !args.pivotReplyEnabled || !args.topicLeadPivotEnabled) {
    reasonCodes.push("lead_block_disabled");
    return { eligible: false, reasonCodes };
  }

  if (args.shouldClose) {
    reasonCodes.push("lead_block_close");
  }
  if (args.conflictCue) {
    reasonCodes.push("lead_block_conflict");
  }
  if (args.pauseCue) {
    reasonCodes.push("lead_block_pause");
  }
  if (args.leadCooldownActive) {
    reasonCodes.push("lead_block_cooldown");
  }
  if (!args.laneExhausted) {
    reasonCodes.push("lead_block_lane_not_exhausted");
  }
  if (args.explicitAskCue) {
    reasonCodes.push("lead_block_explicit_ask");
  }
  const maxUnansweredOutbound = Math.max(1, Math.min(args.maxUnansweredOutboundStreak ?? 1, 3));
  if (args.unansweredOutboundStreak > maxUnansweredOutbound) {
    reasonCodes.push("lead_block_unanswered_outbound");
  }
  if (args.recentIgnoredOrFailedProactive) {
    reasonCodes.push("lead_block_recent_proactive_failure");
  }
  if (
    args.styleMatrixRisk &&
    args.styleMatrixRisk !== "none" &&
    args.styleMatrixRisk !== "romance" &&
    args.styleMatrixRisk !== "work"
  ) {
    reasonCodes.push("lead_block_high_risk_style");
  }
  if (typeof args.styleMatrixConfidence === "number" && args.styleMatrixConfidence < 0.48) {
    reasonCodes.push("lead_block_low_style_confidence");
  }
  if (args.topicDwellScore < 0.55) {
    reasonCodes.push("lead_block_low_dwell");
  }
  if (args.vibeScore < args.minVibeScore) {
    reasonCodes.push("lead_block_low_vibe");
  }

  if (reasonCodes.length > 0) {
    return { eligible: false, reasonCodes };
  }
  return {
    eligible: true,
    reasonCodes: ["lead_pivot"],
  };
}

export function hasTopicCloseCue(text: string) {
  const normalized = normalizeConversationText(text);
  if (!normalized) {
    return false;
  }
  return TOPIC_CLOSE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isCheckInSignalType(signalType: ConversationSignalType): signalType is CheckInSignalType {
  return signalType === "checkin_prompt" || signalType === "checkin_response";
}

export function isTrackableTopicMessageType(messageType: Doc<"messages">["messageType"]) {
  if (!messageType) {
    return true;
  }
  return TRACKABLE_MESSAGE_TYPES.has(messageType as Exclude<Doc<"messages">["messageType"], "reaction" | "sticker" | undefined>);
}

export function buildSignalExcerpt(text: string | undefined, maxChars = 180) {
  const normalized = (text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}
