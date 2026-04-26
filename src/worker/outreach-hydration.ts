import {
  ROMANCE_BASE_VARIANT_COUNT,
  ROMANCE_BOUNDARY_REOPEN_VARIANT_COUNT,
  type RomanceMorningMode,
} from "../../shared/romance-morning";
import { stripEmojiCharacters } from "./emoji-policy";

type OutreachMode = "proactive" | "good_morning" | "compliment";
type GhostReopenTone = "naija_tease" | "hard_banter" | "playful" | "warm";
type GhostSeverity = "mild" | "moderate" | "severe";
type DaypartGreeting = "Good morning" | "Good afternoon" | "Good evening";

const LEAD_MODE_INTENT_LINES = [
  "Lead with warmth and initiative by proposing one simple plan for later today.",
  "Lead the opener with affectionate momentum and one concrete invite.",
  "Set a romantic direction for the day with one grounded plan idea.",
];

const WARM_MODE_INTENT_LINES = [
  "Lead with soft affection and emotional presence before any practical topic.",
  "Keep the opener sweet, grounded, and emotionally attentive.",
  "Start with caring warmth and one gentle, natural check-in question.",
];
const COMPLIMENT_MODE_INTENT_LINES = [
  "Lead with one sincere compliment and zero pressure.",
  "Send one warm appreciation line that feels natural and specific.",
  "Keep it sweet and confident, with no needy or transactional tone.",
];
const COMPLIMENT_PLAYFUL_SCENARIO_INTENT_LINES = [
  "Use a playful imaginary scenario as a flirty joke, then land on a warm compliment.",
  "Make up a tiny absurd story, clearly fictional, and keep it affectionate.",
  "Use light romantic imagination with obvious joke energy and no emotional pressure.",
];
const ROMANCE_ROBOTIC_CUE_PATTERN =
  /\b(assistant|task\s*manager|automation|protocol|scheduled|workflow|ticket|per\s+plan|compliance)\b/i;
const ROMANCE_PRESSURE_CUE_PATTERN =
  /\b(you\s+never\s+reply|answer\s+me|reply\s+now|if\s+you\s+cared|prove\s+it|owe\s+me|don't\s+ignore\s+me|stop\s+ignoring\s+me|where\s+were\s+you)\b/i;
const ROMANCE_COERCIVE_FAKE_STAKES_PATTERN =
  /\b(if\s+you\s+(?:don'?t|do\s+not)|unless\s+you)\b[\s\S]{0,60}\b(die|dead|disappear|survive|make\s+it|won'?t\s+last|rescue|save\s+me)\b/i;
const ROMANCE_PIDGIN_CUE_PATTERN =
  /\b(shey|abi|abeg|wahala|dey|wetin|how\s+far|no\s+be|make\s+we|omo)\b/i;
const GOOD_MORNING_SHORT_CUE_PATTERN = /\b(gm|gud\s*morn(?:ing)?|gud\s*mrng)\b/i;
const SIMPLE_EMOJI_TOKEN_REGEX = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/gu;
const BOUNDARY_REOPEN_PROMPT_VARIATIONS = [
  "Briefly say you did not enjoy being ghosted, then still check on her respectfully.",
  "Briefly say you did not like the silence, then check on her with calm tone.",
  "Briefly say being ignored did not feel good, then still check on her without hostility.",
  "Briefly mention the silence was difficult, then check on her with respect.",
  "Briefly mention being left on read did not feel good, then check in calmly.",
  "Briefly say being shut out was not pleasant, then still check on her politely.",
  "Briefly acknowledge the quiet hurt, then check on her peacefully.",
  "Briefly say being ignored after your message did not feel right, then check on her with grace.",
  "Briefly mention the distance was uncomfortable, then still check on her kindly.",
  "Briefly say you did not like the quiet between you, then check in with good intent.",
  "Briefly say being ghosted did not feel good, then still show calm care.",
  "Briefly say you did not like how contact dropped, then check in as the bigger person.",
  "Briefly mention the silence was unpleasant, then check on her without argument.",
  "Briefly say being ignored was not okay, then still check in calmly.",
  "Briefly mention things going quiet was hard, then check on her respectfully.",
  "Briefly say communication dropping was not ideal, then keep the tone mature and caring.",
  "Briefly say being ghosted was not enjoyable, then check on her without escalating.",
  "Briefly say being left hanging did not feel good, then still check in with peace.",
  "Briefly mention the silent treatment was not pleasant, then check on her calmly.",
  "Briefly say being ignored after reaching out did not feel good, then still check in politely.",
  "Briefly say things going cold did not feel good, then check on her without drama.",
  "Briefly say the silence was not comfortable, then still check on her respectfully.",
  "Briefly say being ignored did not feel good, then keep composure and still check on her.",
] as const;
const BOUNDARY_REOPEN_FALLBACK_VARIATIONS = [
  "Good morning, I did not enjoy being ghosted, but I am choosing peace and still checking on you. Are you okay?",
  "Good morning, I did not like how we went silent, but I am taking the higher road and checking on you. Are you alright?",
  "Good morning, being ignored did not feel good, but I am choosing calm and still checking on you. How are you today?",
  "Good morning, I did not enjoy the silence, but I am still choosing respect and checking on you. Are you okay today?",
  "Good morning, I did not like being left on read, but I am choosing maturity and checking on you. I hope you are alright?",
  "Good morning, I did not enjoy being shut out, but I am keeping it calm and still checking on you. Are you okay?",
  "Good morning, the silence was not pleasant for me, but I would rather choose peace and check on you. How are you doing?",
  "Good morning, I did not like being ignored after reaching out, but I am still checking on you respectfully. Are you okay?",
  "Good morning, I did not enjoy how distant things felt, but I am choosing grace and checking on you. How are you today?",
  "Good morning, I did not like the quiet between us, but I am still checking in with good intentions. Are you alright?",
  "Good morning, I did not enjoy being ghosted like that, but I am choosing calm and care while checking on you. Are you okay?",
  "Good morning, I did not like how we lost touch this way, but I am taking the bigger-person route and checking on you. How are you?",
  "Good morning, I did not enjoy that silence at all, but I am not here to fight, just to check on you. Are you okay?",
  "Good morning, I did not like being ignored, honestly, but I am still checking in from a calm place. Are you alright?",
  "Good morning, I did not enjoy how things went quiet, but I am choosing respect and still checking on you. How are you feeling?",
  "Good morning, I did not like the way communication dropped, but I am keeping it mature and checking on you. Are you okay?",
  "Good morning, I did not enjoy being ghosted, but I am not escalating it and I am still checking on you today. Are you alright?",
  "Good morning, I did not like being left hanging, but I am choosing peace and checking in anyway. How are you doing?",
  "Good morning, I did not enjoy that silent treatment, but I am still reaching out with calm energy. Are you okay today?",
  "Good morning, I did not like being ignored after my earlier message, but I am still choosing the bigger person approach. Are you alright?",
  "Good morning, I did not enjoy how we went cold, but I am checking on you without drama. How are you today?",
  "Good morning, I did not like that silence, but I am keeping it respectful and still checking on you. Are you okay?",
  "Good morning, I did not enjoy being ignored, yet I am choosing composure and still checking on you. Are you alright today?",
] as const;

function normalizeBaseVariant(variant: number | undefined) {
  const resolved = Math.round(variant ?? 0);
  return ((resolved % ROMANCE_BASE_VARIANT_COUNT) + ROMANCE_BASE_VARIANT_COUNT) % ROMANCE_BASE_VARIANT_COUNT;
}

function normalizeBoundaryVariant(variant: number | undefined) {
  const resolved = Math.round(variant ?? 0);
  return (
    (resolved % ROMANCE_BOUNDARY_REOPEN_VARIANT_COUNT) + ROMANCE_BOUNDARY_REOPEN_VARIANT_COUNT
  ) % ROMANCE_BOUNDARY_REOPEN_VARIANT_COUNT;
}

function resolveRomanceIntentLine(args: {
  mode: RomanceMorningMode;
  variant: number | undefined;
}) {
  const variant = normalizeBaseVariant(args.variant);
  return args.mode === "lead" ? LEAD_MODE_INTENT_LINES[variant] : WARM_MODE_INTENT_LINES[variant];
}

function resolveBoundaryReopenLine(variant: number | undefined) {
  return BOUNDARY_REOPEN_PROMPT_VARIATIONS[normalizeBoundaryVariant(variant)];
}

function resolveBoundaryReopenFallback(variant: number | undefined) {
  return BOUNDARY_REOPEN_FALLBACK_VARIATIONS[normalizeBoundaryVariant(variant)];
}

function resolveDaypartGreeting(nowMs: number | undefined): DaypartGreeting {
  const now = Number.isFinite(nowMs) ? new Date(nowMs as number) : new Date();
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) {
    return "Good morning";
  }
  if (hour >= 12 && hour < 17) {
    return "Good afternoon";
  }
  return "Good evening";
}

function applyDaypartGreeting(text: string, greeting: DaypartGreeting) {
  return normalizeSingleLine(text).replace(/^Good morning\b/i, greeting);
}

function resolveComplimentIntentLine(variant: number | undefined) {
  const resolved = Math.round(variant ?? 0);
  const index = ((resolved % COMPLIMENT_MODE_INTENT_LINES.length) + COMPLIMENT_MODE_INTENT_LINES.length) %
    COMPLIMENT_MODE_INTENT_LINES.length;
  return COMPLIMENT_MODE_INTENT_LINES[index];
}

function resolveComplimentPlayfulIntentLine(variant: number | undefined) {
  const resolved = Math.round(variant ?? 0);
  const index =
    ((resolved % COMPLIMENT_PLAYFUL_SCENARIO_INTENT_LINES.length) + COMPLIMENT_PLAYFUL_SCENARIO_INTENT_LINES.length) %
    COMPLIMENT_PLAYFUL_SCENARIO_INTENT_LINES.length;
  return COMPLIMENT_PLAYFUL_SCENARIO_INTENT_LINES[index];
}

export function buildOutreachPromptSeed(args: {
  outreachMode: OutreachMode;
  romanceMorningMode?: RomanceMorningMode;
  romancePromptVariant?: number;
  ignoredBoundaryReopen?: boolean;
  complimentPlayfulScenario?: boolean;
  ghostReopenInstruction?: string;
  daysSinceMutualCheckIn?: number;
  checkInRecencyTargetDays?: number;
  memorySummary?: string;
  contactName: string;
}) {
  if (args.outreachMode === "good_morning") {
    return [
      "Write one adaptive good-morning opener for this romantic contact.",
      `Mode: ${args.romanceMorningMode || "warm"}.`,
      resolveRomanceIntentLine({
        mode: args.romanceMorningMode || "warm",
        variant: args.romancePromptVariant,
      }),
      args.ignoredBoundaryReopen
        ? "This is a calm re-open after a 3-day pause due to silence."
        : "",
      args.ignoredBoundaryReopen
        ? resolveBoundaryReopenLine(args.romancePromptVariant)
        : "",
      args.ignoredBoundaryReopen
        ? "Do not blame, pressure, guilt-trip, or sound hostile."
        : "",
      "Keep it to 1-2 short sentences in natural chat language.",
      "Always write 'Good morning' in full, never 'GM' or shorthand variants.",
      "Use plain conversational English only; do not use pidgin wording.",
      "No robotic, assistant, task-manager, or sales wording.",
      "At most one gentle question and at most one emoji.",
      "No guilt, pressure, jealousy cues, or accusatory tone.",
      args.memorySummary,
      `Contact first name: ${args.contactName}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (args.outreachMode === "compliment") {
    return [
      args.complimentPlayfulScenario
        ? "Write one playful fake-scenario message for this romantic contact."
        : "Write one out-of-the-blue appreciation message for this romantic contact.",
      args.complimentPlayfulScenario
        ? resolveComplimentPlayfulIntentLine(args.romancePromptVariant)
        : resolveComplimentIntentLine(args.romancePromptVariant),
      args.complimentPlayfulScenario
        ? "Make it clearly fictional and obviously joke-like, then end with real warmth."
        : "Make it feel like a spontaneous compliment, not a routine check-in.",
      "Keep it to 1-2 short sentences in natural chat language.",
      "Use plain conversational English only; do not use pidgin wording.",
      "No robotic, assistant, task-manager, or sales wording.",
      "Do not ask for validation, commitment, or immediate reply.",
      "No fake-threat stakes about death, emergencies, or abandonment.",
      "At most one gentle question and at most one emoji.",
      "No guilt, pressure, jealousy cues, or accusatory tone.",
      args.memorySummary,
      `Contact first name: ${args.contactName}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const checkInRecencyTargetDays = Math.max(1, Math.round(args.checkInRecencyTargetDays ?? 7));
  const daysSinceMutualCheckIn = Number.isFinite(args.daysSinceMutualCheckIn)
    ? Math.max(0, Math.round(args.daysSinceMutualCheckIn as number))
    : undefined;
  const recentMutualCheckIn =
    daysSinceMutualCheckIn !== undefined && daysSinceMutualCheckIn < checkInRecencyTargetDays;
  const mutualCheckInGuidance =
    daysSinceMutualCheckIn === undefined
      ? `No known mutual check-in on record. Prioritize a warm wellbeing check-in opener.`
      : recentMutualCheckIn
        ? `Recent mutual check-in was ${daysSinceMutualCheckIn} day(s) ago. Do not open with a generic "just checking in" line; use light continuity or a fresh topic hook.`
        : `Last mutual check-in was ${daysSinceMutualCheckIn} day(s) ago (target ${checkInRecencyTargetDays} days). Prioritize a warm wellbeing check-in opener.`;

  return [
    "Proactively start a fresh check-in conversation with this contact now.",
    "Use previous chat context so the opener feels natural, specific, and warm.",
    mutualCheckInGuidance,
    "Keep it to 1-2 short sentences, avoid sounding robotic, and include exactly one gentle question.",
    "Do not sound needy, accusatory, or passive-aggressive.",
    args.ghostReopenInstruction,
    args.memorySummary,
    `Contact first name: ${args.contactName}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildOutreachFallbackText(args: {
  outreachMode: OutreachMode;
  romanceMorningMode?: RomanceMorningMode;
  romancePromptVariant?: number;
  ignoredBoundaryReopen?: boolean;
  complimentPlayfulScenario?: boolean;
  daysSinceMutualCheckIn?: number;
  checkInRecencyTargetDays?: number;
  longSilenceGhostReopen: boolean;
  ghostReopenTone: GhostReopenTone;
  ghostSeverity: GhostSeverity;
  nowMs?: number;
}) {
  const daypartGreeting = resolveDaypartGreeting(args.nowMs);
  if (args.outreachMode === "good_morning") {
    if (args.ignoredBoundaryReopen) {
      return applyDaypartGreeting(resolveBoundaryReopenFallback(args.romancePromptVariant), daypartGreeting);
    }
    if (args.romanceMorningMode === "lead") {
      return `${daypartGreeting}, I want to make today sweet for us. What time works for a quick plan later?`;
    }
    return daypartGreeting === "Good morning"
      ? "Good morning, sending you warm energy. How are you feeling this morning?"
      : `${daypartGreeting}, sending you warm energy. How are you feeling today?`;
  }

  if (args.outreachMode === "compliment") {
    if (args.complimentPlayfulScenario) {
      return "Random confession: in my imaginary kingdom, your smile keeps the sun online. You really do brighten my day.";
    }
    return "You have such a beautiful energy, and I still catch myself smiling when I think of you.";
  }

  const checkInRecencyTargetDays = Math.max(1, Math.round(args.checkInRecencyTargetDays ?? 7));
  const daysSinceMutualCheckIn = Number.isFinite(args.daysSinceMutualCheckIn)
    ? Math.max(0, Math.round(args.daysSinceMutualCheckIn as number))
    : undefined;

  if (!args.longSilenceGhostReopen) {
    if (daysSinceMutualCheckIn !== undefined && daysSinceMutualCheckIn < checkInRecencyTargetDays) {
      return "Hey, quick one for today: what has been the highlight of your day so far?";
    }
    return "Hey, just checking in. How is your day going?";
  }

  if (args.ghostReopenTone === "naija_tease") {
    return args.ghostSeverity === "severe"
      ? "Shey you ghost me finish abi 😭. Hope you dey alright?"
      : "Shey you ghost me abi 😄. How have you been lately?";
  }
  if (args.ghostReopenTone === "hard_banter") {
    return args.ghostSeverity === "severe"
      ? "You sly mf, you ghosted me 😭. You good though?"
      : "You sly one, you ghosted me small 😅. You good?";
  }
  if (args.ghostReopenTone === "playful") {
    return args.ghostSeverity === "severe"
      ? "Omo, you ghosted me hard 😭. How have you been though?"
      : "You ghosted me small 😅. How have you been?";
  }
  return args.ghostSeverity === "severe"
    ? "You really disappeared on me 😅. Hope you're doing well?"
    : "You ghosted me a little 😅. How have you been lately?";
}

function normalizeSingleLine(text: string) {
  return text
    .replace(/\s*\n+\s*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function countSentences(text: string) {
  const normalized = normalizeSingleLine(text);
  if (!normalized) {
    return 0;
  }
  const parts = normalized
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return Math.max(1, parts.length);
}

function trimToTwoSentences(text: string) {
  const normalized = normalizeSingleLine(text);
  const parts = normalized
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 2) {
    return normalized;
  }
  return parts.slice(0, 2).join(" ").trim();
}

function keepAtMostOneQuestion(text: string) {
  let seen = false;
  return text.replace(/\?/g, () => {
    if (!seen) {
      seen = true;
      return "?";
    }
    return ".";
  });
}

function keepAtMostOneEmoji(text: string) {
  const matches = text.match(SIMPLE_EMOJI_TOKEN_REGEX) || [];
  if (matches.length <= 1) {
    return text;
  }
  const firstEmoji = matches[0];
  const stripped = stripEmojiCharacters(text);
  return `${stripped} ${firstEmoji}`.trim();
}

function enforceGoodMorningOpening(text: string, greeting: DaypartGreeting) {
  let next = text.trim();
  let changed = false;

  if (GOOD_MORNING_SHORT_CUE_PATTERN.test(next)) {
    next = next.replace(/\b(gm|gud\s*morn(?:ing)?|gud\s*mrng)\b/gi, greeting);
    changed = true;
  }

  if (/^morning\b/i.test(next)) {
    next = next.replace(/^morning\b/i, greeting);
    changed = true;
  }

  if (!/^good (morning|afternoon|evening)\b/i.test(next)) {
    next = `${greeting}, ${next}`.replace(/,\s*,/g, ",");
    changed = true;
  } else if (!new RegExp(`^${greeting}\\b`, "i").test(next)) {
    next = next.replace(/^good (morning|afternoon|evening)\b/i, greeting);
    changed = true;
  }

  return {
    text: normalizeSingleLine(next),
    changed,
  };
}

export function enforceGoodMorningStyleLint(args: {
  text: string;
  fallbackText: string;
  nowMs?: number;
}) {
  const violations: string[] = [];
  let next = normalizeSingleLine(args.text);
  const daypartGreeting = resolveDaypartGreeting(args.nowMs);
  const fallback = normalizeSingleLine(
    args.fallbackText || `${daypartGreeting}, hope you are having a beautiful day.`,
  );
  if (!next) {
    return {
      text: fallback,
      violations: ["empty_text"],
    };
  }

  if (ROMANCE_ROBOTIC_CUE_PATTERN.test(next)) {
    return {
      text: fallback,
      violations: ["robotic_task_wording"],
    };
  }
  if (ROMANCE_PRESSURE_CUE_PATTERN.test(next)) {
    return {
      text: fallback,
      violations: ["pressure_or_guilt_wording"],
    };
  }
  if (ROMANCE_PIDGIN_CUE_PATTERN.test(next)) {
    return {
      text: fallback,
      violations: ["pidgin_wording"],
    };
  }

  const openingNormalized = enforceGoodMorningOpening(next, daypartGreeting);
  if (openingNormalized.changed) {
    violations.push("good_morning_opening_normalized");
  }
  next = openingNormalized.text;

  const sentenceCount = countSentences(next);
  if (sentenceCount > 2) {
    violations.push("too_many_sentences");
    next = trimToTwoSentences(next);
  }

  const originalQuestionCount = (normalizeSingleLine(args.text).match(/\?/g) || []).length;
  if (originalQuestionCount > 1) {
    violations.push("too_many_questions");
  }
  const questionCount = (next.match(/\?/g) || []).length;
  if (questionCount > 1) {
    next = keepAtMostOneQuestion(next);
  }

  const originalEmojiCount = (normalizeSingleLine(args.text).match(SIMPLE_EMOJI_TOKEN_REGEX) || []).length;
  if (originalEmojiCount > 1) {
    violations.push("too_many_emojis");
  }
  const emojiCount = (next.match(SIMPLE_EMOJI_TOKEN_REGEX) || []).length;
  if (emojiCount > 1) {
    next = keepAtMostOneEmoji(next);
  }

  next = normalizeSingleLine(next);
  if (!next) {
    return {
      text: fallback,
      violations: [...violations, "empty_after_rewrite"],
    };
  }
  return {
    text: next,
    violations,
  };
}

export function enforceComplimentStyleLint(args: {
  text: string;
  fallbackText: string;
}) {
  const violations: string[] = [];
  let next = normalizeSingleLine(args.text);
  const fallback = normalizeSingleLine(
    args.fallbackText || "You have such a beautiful energy, and I still catch myself smiling when I think of you.",
  );
  if (!next) {
    return {
      text: fallback,
      violations: ["empty_text"],
    };
  }

  if (ROMANCE_ROBOTIC_CUE_PATTERN.test(next)) {
    return {
      text: fallback,
      violations: ["robotic_task_wording"],
    };
  }
  if (ROMANCE_PRESSURE_CUE_PATTERN.test(next)) {
    return {
      text: fallback,
      violations: ["pressure_or_guilt_wording"],
    };
  }
  if (ROMANCE_COERCIVE_FAKE_STAKES_PATTERN.test(next)) {
    return {
      text: fallback,
      violations: ["coercive_fake_stakes"],
    };
  }
  if (ROMANCE_PIDGIN_CUE_PATTERN.test(next)) {
    return {
      text: fallback,
      violations: ["pidgin_wording"],
    };
  }

  const sentenceCount = countSentences(next);
  if (sentenceCount > 2) {
    violations.push("too_many_sentences");
    next = trimToTwoSentences(next);
  }

  const originalQuestionCount = (normalizeSingleLine(args.text).match(/\?/g) || []).length;
  if (originalQuestionCount > 1) {
    violations.push("too_many_questions");
  }
  const questionCount = (next.match(/\?/g) || []).length;
  if (questionCount > 1) {
    next = keepAtMostOneQuestion(next);
  }

  const originalEmojiCount = (normalizeSingleLine(args.text).match(SIMPLE_EMOJI_TOKEN_REGEX) || []).length;
  if (originalEmojiCount > 1) {
    violations.push("too_many_emojis");
  }
  const emojiCount = (next.match(SIMPLE_EMOJI_TOKEN_REGEX) || []).length;
  if (emojiCount > 1) {
    next = keepAtMostOneEmoji(next);
  }

  next = normalizeSingleLine(next);
  if (!next) {
    return {
      text: fallback,
      violations: [...violations, "empty_after_rewrite"],
    };
  }
  return {
    text: next,
    violations,
  };
}
