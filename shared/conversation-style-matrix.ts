export type ConversationStyleRelationship =
  | "romantic"
  | "close_friend"
  | "family"
  | "community_group"
  | "coworker"
  | "vendor_service"
  | "authority"
  | "acquaintance"
  | "general";

export type ConversationStyleRegister =
  | "intimate"
  | "casual"
  | "neutral"
  | "polite_formal"
  | "professional"
  | "ceremonial";

export type ConversationStylePoliteness =
  | "direct"
  | "softened"
  | "deferential"
  | "boundary_setting"
  | "repair_accountability";

export type ConversationStyleEnergy = "terse" | "calm" | "warm" | "playful" | "expressive";
export type ConversationStyleLocaleDialect = "standard_english" | "nigerian_pidgin" | "naija_english" | "mixed";
export type ConversationStyleInteractionMove =
  | "answer"
  | "clarify"
  | "confirm"
  | "close"
  | "repair"
  | "lead"
  | "comfort"
  | "decline"
  | "celebrate"
  | "advise"
  | "listen";
export type ConversationStyleRiskSensitivity =
  | "none"
  | "health"
  | "money"
  | "conflict"
  | "romance"
  | "work"
  | "legal_financial"
  | "identity";
export type ConversationEmojiTextPolicy = "strip" | "allow_limited";

export type ConversationStyleMatrixResult = {
  relationship: ConversationStyleRelationship;
  register: ConversationStyleRegister;
  politeness: ConversationStylePoliteness;
  energy: ConversationStyleEnergy;
  localeDialect: ConversationStyleLocaleDialect;
  interactionMove: ConversationStyleInteractionMove;
  riskSensitivity: ConversationStyleRiskSensitivity;
  confidence: number;
  reasonCodes: string[];
  dynamicStylePackIds: string[];
  emojiTextPolicy: ConversationEmojiTextPolicy;
};

export type ConversationStyleMatrixInput = {
  inboundText: string;
  recentHistoryLines?: string[];
  relevantHistoryLines?: string[];
  threadKind?: "direct" | "group" | "broadcast_or_system" | string;
  provider?: "whatsapp" | "instagram" | string;
  profileSlug?: string;
  profileName?: string;
  conversationGuidance?: {
    shouldClose?: boolean;
    shouldLeadPivot?: boolean;
    shouldCheckIn?: boolean;
    topicDwellScore?: number;
    vibeScore?: number;
    reasonCodes?: string[];
  };
  learnedEmojiAllowlist?: string[];
  learnedEmojiCategoryHints?: string[];
};

const PIDGIN_PATTERN =
  /\b(abeg|dey|sha|wahala|oga|omo|abi|wetin|na so|no vex|how far|e don|make we|chale|sabi)\b/i;
const NAIJA_ENGLISH_PATTERN = /\b(kindly|please|noted|boss|chairman|ma|sir|madam|small|now now|send am)\b/i;
const EMOJI_HINT_PATTERN = /\b(emoji|sticker|reaction|lol|lmao|haha|😂|🤣|😌|❤️|💕)\b/i;

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(value, 1));
}

function corpus(args: ConversationStyleMatrixInput) {
  return [
    args.inboundText,
    ...(args.recentHistoryLines || []).slice(-8),
    ...(args.relevantHistoryLines || []).slice(-6),
  ]
    .filter(Boolean)
    .join(" ");
}

function has(text: string, pattern: RegExp) {
  return pattern.test(text);
}

function addUnique(values: string[], value: string) {
  if (!values.includes(value)) {
    values.push(value);
  }
}

export function computeConversationStyleMatrix(args: ConversationStyleMatrixInput): ConversationStyleMatrixResult {
  const text = args.inboundText.trim();
  const lower = text.toLowerCase();
  const full = corpus(args);
  const fullLower = full.toLowerCase();
  const slug = (args.profileSlug || "").trim().toLowerCase();
  const profileName = (args.profileName || "").trim().toLowerCase();
  const reasonCodes: string[] = [];
  const dynamicStylePackIds: string[] = [];
  let confidence = 0.5;

  let relationship: ConversationStyleRelationship = "general";
  if (slug === "girlfriend" || slug === "relationship" || has(full, /\b(love you|miss you|babe|baby|date|romantic|kiss|hug)\b/i)) {
    relationship = "romantic";
    addUnique(reasonCodes, "relationship_romantic");
    confidence += 0.12;
  } else if (slug === "family" || has(full, /\b(mom|mum|mother|dad|father|sister|brother|aunt|uncle|cousin|family)\b/i)) {
    relationship = "family";
    addUnique(dynamicStylePackIds, "family_core.v1");
    addUnique(reasonCodes, "relationship_family");
    confidence += 0.14;
  } else if (slug === "community_group" || args.threadKind === "group" || has(full, /\b(group chat|community|team chat|everyone|guys|house|church|club)\b/i)) {
    relationship = "community_group";
    addUnique(dynamicStylePackIds, "group_community.v1");
    addUnique(reasonCodes, "relationship_group");
    confidence += 0.1;
  } else if (slug === "vendor_service" || has(full, /\b(order|refund|delivery|vendor|service|complaint|customer|support|invoice|receipt)\b/i)) {
    relationship = "vendor_service";
    addUnique(dynamicStylePackIds, "vendor_service.v1");
    addUnique(reasonCodes, "relationship_vendor_service");
    confidence += 0.1;
  } else if (slug === "mentorship" || has(full, /\b(mentor|advice|career|teach me|guide me|feedback|review my|learn)\b/i)) {
    relationship = "coworker";
    addUnique(dynamicStylePackIds, "mentorship.v1");
    addUnique(reasonCodes, "relationship_mentorship");
    confidence += 0.08;
  } else if (slug === "professional" || profileName.includes("professional") || has(full, /\b(client|deadline|deliverable|stakeholder|proposal|meeting|project)\b/i)) {
    relationship = "coworker";
    addUnique(reasonCodes, "relationship_work");
    confidence += 0.08;
  } else if (slug === "friendship" || has(full, /\b(friend|bestie|bro|sis|homie|fam|hang out|catch up)\b/i)) {
    relationship = "close_friend";
    addUnique(reasonCodes, "relationship_friend");
    confidence += 0.08;
  }

  let riskSensitivity: ConversationStyleRiskSensitivity = "none";
  if (has(full, /\b(password|otp|pin|identity|passport|ssn|social security|api key|secret)\b/i)) {
    riskSensitivity = "identity";
    addUnique(reasonCodes, "risk_identity");
  } else if (has(full, /\b(court|lawyer|legal|lawsuit|police|arrest)\b/i)) {
    riskSensitivity = "legal_financial";
    addUnique(reasonCodes, "risk_legal");
  } else if (has(full, /\b(sick|hospital|surgery|diagnosis|cancer|accident|therapy|panic|depressed|suicid)\b/i)) {
    riskSensitivity = "health";
    addUnique(dynamicStylePackIds, "grief_support.v1");
    addUnique(reasonCodes, "risk_health");
  } else if (has(full, /\b(debt|loan|rent|salary|payment|transfer|owe|budget|forex|stock|bond|invest)\b/i)) {
    riskSensitivity = "money";
    addUnique(reasonCodes, "risk_money");
  } else if (has(full, /\b(hurt|harsh|angry|upset|fight|argument|misunderstood|sorry|apologize|my bad)\b/i)) {
    riskSensitivity = "conflict";
    addUnique(dynamicStylePackIds, "conflict_repair.v1");
    addUnique(reasonCodes, "risk_conflict");
  } else if (relationship === "romantic") {
    riskSensitivity = "romance";
  } else if (relationship === "coworker" || relationship === "vendor_service") {
    riskSensitivity = "work";
  }

  let interactionMove: ConversationStyleInteractionMove = "answer";
  if (args.conversationGuidance?.shouldClose || has(lower, /\b(goodnight|bye|talk later|end here|leave it|drop it)\b/i)) {
    interactionMove = "close";
    addUnique(reasonCodes, "move_close");
  } else if (has(lower, /\b(sorry|apologize|my bad|i was wrong|that was on me|hurt you|came off harsh)\b/i)) {
    interactionMove = "repair";
    addUnique(dynamicStylePackIds, "conflict_repair.v1");
    addUnique(reasonCodes, "move_repair");
  } else if (has(lower, /\b(condolence|lost someone|passed away|died|grief|funeral|rough day|drained|overwhelmed|worried|sick)\b/i)) {
    interactionMove = "comfort";
    addUnique(dynamicStylePackIds, "grief_support.v1");
    addUnique(reasonCodes, "move_comfort");
  } else if (has(lower, /\b(congrats|congratulations|i got the|promotion|passed|won|offer)\b/i)) {
    interactionMove = "celebrate";
    addUnique(reasonCodes, "move_celebrate");
  } else if (has(lower, /\b(can't|cannot|not able|no longer|need space|boundary|not comfortable)\b/i)) {
    interactionMove = "decline";
    addUnique(reasonCodes, "move_decline");
  } else if (has(lower, /\b(what do you mean|which one|clarify|not sure|this one|that one)\b/i) || (/^(this|that|it|which)\b/i.test(lower) && lower.length < 40)) {
    interactionMove = "clarify";
    addUnique(reasonCodes, "move_clarify");
  } else if (args.conversationGuidance?.shouldLeadPivot || has(lower, /\b(what should i do|advise|advice|recommend|guide me|mentor|feedback|review my)\b/i)) {
    interactionMove = has(lower, /\b(advise|advice|recommend|guide me|mentor|feedback|review my)\b/i) ? "advise" : "lead";
    addUnique(reasonCodes, interactionMove === "advise" ? "move_advise" : "move_lead");
  } else if (has(lower, /\b(ok|okay|sure|noted|seen|got it|received)\b/i) && lower.length <= 28) {
    interactionMove = "confirm";
    addUnique(reasonCodes, "move_confirm");
  }

  let register: ConversationStyleRegister = "neutral";
  if (relationship === "romantic") {
    register = "intimate";
  } else if (relationship === "coworker" || relationship === "vendor_service") {
    register = "professional";
  } else if (has(full, /\b(kindly|sir|ma|madam|at your convenience|appreciate)\b/i)) {
    register = "polite_formal";
  } else if (relationship === "close_friend" || relationship === "community_group") {
    register = "casual";
  }

  let politeness: ConversationStylePoliteness = "softened";
  if (interactionMove === "repair") {
    politeness = "repair_accountability";
  } else if (interactionMove === "decline" || has(lower, /\b(boundary|not comfortable|need space)\b/i)) {
    politeness = "boundary_setting";
  } else if (register === "professional" || has(full, /\b(kindly|sir|ma|madam|please)\b/i)) {
    politeness = "deferential";
  } else if (has(lower, /\b(now|send|confirm|do it|decide|choose)\b/i)) {
    politeness = "direct";
  }

  let energy: ConversationStyleEnergy = "calm";
  if (text.split(/\s+/).filter(Boolean).length <= 3) {
    energy = "terse";
  } else if (has(full, /\b(lol|lmao|haha|funny|joke|banter|tease)\b/i)) {
    energy = "playful";
  } else if (/[!]{2,}/.test(text) || has(text, /\b(so happy|amazing|excited|let's go)\b/i)) {
    energy = "expressive";
  } else if (relationship === "romantic" || relationship === "family" || interactionMove === "comfort" || interactionMove === "celebrate") {
    energy = "warm";
  }

  const localeDialect: ConversationStyleLocaleDialect = PIDGIN_PATTERN.test(full)
    ? "nigerian_pidgin"
    : NAIJA_ENGLISH_PATTERN.test(full)
      ? "naija_english"
      : "standard_english";
  if (localeDialect !== "standard_english") {
    addUnique(reasonCodes, `locale_${localeDialect}`);
    confidence += 0.08;
  }

  if (riskSensitivity !== "none") {
    confidence += 0.1;
  }
  if (interactionMove !== "answer") {
    confidence += 0.08;
  }
  if (reasonCodes.length <= 1) {
    addUnique(reasonCodes, "low_signal_default");
  }

  const emojiEligibleRelationship =
    relationship === "romantic" ||
    relationship === "close_friend" ||
    relationship === "family" ||
    relationship === "community_group";
  const highRiskForEmoji =
    riskSensitivity === "health" ||
    riskSensitivity === "money" ||
    riskSensitivity === "conflict" ||
    riskSensitivity === "legal_financial" ||
    riskSensitivity === "identity" ||
    relationship === "vendor_service" ||
    register === "professional";
  const learnedEmojiSignal =
    Boolean(args.learnedEmojiAllowlist?.length) ||
    Boolean(args.learnedEmojiCategoryHints?.length) ||
    EMOJI_HINT_PATTERN.test(fullLower);
  const emojiTextPolicy: ConversationEmojiTextPolicy =
    emojiEligibleRelationship && !highRiskForEmoji && (energy === "playful" || energy === "warm" || learnedEmojiSignal)
      ? "allow_limited"
      : "strip";
  addUnique(reasonCodes, emojiTextPolicy === "allow_limited" ? "emoji_limited_allowed" : "emoji_stripped");

  return {
    relationship,
    register,
    politeness,
    energy,
    localeDialect,
    interactionMove,
    riskSensitivity,
    confidence: clamp01(confidence),
    reasonCodes,
    dynamicStylePackIds,
    emojiTextPolicy,
  };
}

export function summarizeConversationStyleMatrix(matrix: ConversationStyleMatrixResult) {
  return [
    `relationship=${matrix.relationship}`,
    `register=${matrix.register}`,
    `politeness=${matrix.politeness}`,
    `energy=${matrix.energy}`,
    `locale=${matrix.localeDialect}`,
    `move=${matrix.interactionMove}`,
    `risk=${matrix.riskSensitivity}`,
    `emoji=${matrix.emojiTextPolicy}`,
    `confidence=${Math.round(matrix.confidence * 100)}%`,
    matrix.dynamicStylePackIds.length ? `dynamic_packs=${matrix.dynamicStylePackIds.join(",")}` : "dynamic_packs=none",
    matrix.reasonCodes.length ? `reasons=${matrix.reasonCodes.join(",")}` : "reasons=none",
  ].join("\n");
}
