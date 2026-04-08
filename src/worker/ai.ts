import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ModelClient, { isUnexpected } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";
import {
  type PersonaPack,
  type QualityGateMode,
  getPersonaPackById,
  selectFewShotsForPrompt,
} from "../../convex/lib/personaPacks";
import {
  buildPidginReplyInstruction,
  hasPidginHardStopCue,
  hasPidginPauseCue,
  hasPidginSignal,
  hasPidginWrapUpCue,
  normalizePidginFamilyTerms,
} from "../../shared/pidgin-lexicon";
import { stripEmojiCharacters } from "./emoji-policy";

const execFileAsync = promisify(execFile);

type AiResult = {
  text: string;
  provider: "azure" | "codex" | "heuristic";
  model: string;
  latencyMs: number;
  guardrailBlocked: boolean;
  guardrailReason?: string;
  qualityScore?: number;
  qualityChecks?: QualityCheck[];
  qualityRewriteApplied?: boolean;
  activePersonaPackId?: string;
  attempts: AiAttempt[];
  contextToolCalls?: ContextToolCall[];
  contextWindow?: ContextWindowStats;
};

export type AiAttempt = {
  provider: "azure" | "codex" | "heuristic";
  stage:
    | "azure_sdk"
    | "azure_http"
    | "azure_responses"
    | "codex_cli"
    | "heuristic_guardrail"
    | "heuristic_fallback"
    | "humor_judge_azure"
    | "humor_judge_codex";
  model: string;
  status: "success" | "error";
  latencyMs: number;
  error?: string;
};

export type QualityCheck = {
  id: string;
  label: string;
  score: number;
  passed: boolean;
  detail: string;
};

type AttemptOutcome = {
  result?: Omit<AiResult, "attempts">;
  attempts: AiAttempt[];
};

export type ImageAnalysisResult = {
  description: string;
  provider: "azure" | "heuristic";
  model: string;
  latencyMs: number;
  error?: string;
};

export type MemeImageGenerationResult = {
  imageBytes?: Buffer;
  mimeType: string;
  prompt: string;
  promptHash: string;
  provider: "azure";
  model: string;
  latencyMs: number;
  error?: string;
};

type StyleProfileContext = {
  mimicryLevel?: number;
  commonPhrases?: string[];
  punctuationStyle?: string[];
  humorNotes?: string[];
  spellingNotes?: string[];
};

type PersonalityContext = {
  profileSlug?: string;
  profileName?: string;
  profileDescription?: string;
  profilePrompt?: string;
  intensity?: number;
  customPrompt?: string;
  threadPromptProfile?: string;
  threadPromptProfileSource?: "manual" | "auto";
};

type GroundingContext = {
  myName?: string;
  theirName?: string;
  autoAliases?: string[];
  vibeNotes?: string;
};

type AzureApiStyle = "auto" | "chat_completions" | "responses";
type FallbackMode = "all" | "azure_only";
export type ConversationSteeringMode = "none" | "hard_stop" | "pause" | "wrap_up" | "loop";
export type ContextToolName = "context_window_detection" | "context_window_cleaning" | "conversation_history_search";

export type ContextToolCall = {
  name: ContextToolName;
  latencyMs: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
};

export type ContextWindowStats = {
  estimatedPromptTokens: number;
  maxContextTokens: number;
  reserveOutputTokens: number;
  overflowTokens: number;
  usedHistoryLines: number;
  relevantHistoryLines: number;
};

type RuntimeAiTuning = {
  model?: string;
  apiStyle?: AzureApiStyle;
  fallbackMode?: FallbackMode;
  systemInstruction?: string;
  replyPolicyInstruction?: string;
  activePersonaPackId?: string;
  qualityGateMode?: QualityGateMode;
  qualityGateThreshold?: number;
  soulModeEnabled?: boolean;
  funnyStatusKeywords?: string[];
  funnyStatusEmojis?: string[];
  temperature?: number;
  maxOutputTokens?: number;
  maxReplyChars?: number;
  historyLineLimit?: number;
  maxContextTokens?: number;
  contextReserveTokens?: number;
  contextSearchLineLimit?: number;
  contextOverflowLineDropStep?: number;
  codexTimeoutMs?: number;
  delayMinMs?: number;
  delayMaxMs?: number;
  typingMinMs?: number;
  typingMaxMs?: number;
};

type AzureConfig = {
  endpoint: string;
  apiKey: string;
  model: string;
  apiStyle: Exclude<AzureApiStyle, "auto">;
  systemInstruction: string;
  temperature: number;
  maxOutputTokens: number;
};

type HumorJudgment = {
  isJokeAttempt: boolean;
  isFunny: boolean;
  confidence: number;
  reason: string;
  provider: "azure" | "codex";
  model: string;
};

type JokeGuardrailCode = "none" | "cringe" | "similar_prior_joke" | "recent_joke_chain";

type JokeGuardrailResult = {
  blocked: boolean;
  reason: string;
  code: JokeGuardrailCode;
};

const HARD_CODED_AZURE_DEFAULTS: {
  endpoint: string;
  apiKey: string;
  model: string;
  apiStyle: AzureApiStyle;
  systemInstruction: string;
  replyPolicyInstruction: string;
} = {
  // Optional local defaults if env vars are unavailable. Keep empty unless intentionally using hardcoded values.
  endpoint: "",
  apiKey: "",
  model: "gpt-5.4",
  apiStyle: "auto",
  systemInstruction: "",
  replyPolicyInstruction: "",
};

const HIGH_RISK_PATTERNS = [
  /password/i,
  /otp/i,
  /bank\s*account/i,
  /wire\s*transfer/i,
  /social\s*security/i,
];

const LOW_VALUE_REPLY_PATTERNS = [
  /^sounds good[.!]?\s*i(?:'|\u2019)ll handle it and update you soon[.!]?$/i,
  /^noted[.!]?\s*i(?:'|\u2019)m on it and i(?:'|\u2019)ll circle back soon[.!]?$/i,
  /^got it[,]?\s*i(?:'|\u2019)m on it[.!]?$/i,
  /^(sounds good|noted|got it|understood)[.!]?$/i,
];

const LOW_VALUE_GENERIC_PHRASE_PATTERNS = [
  /\b(?:sounds good|noted|got it|understood|i hear you)\b/i,
  /\bi(?:'|’)ll (?:handle|sort|check|look into|get (?:this )?done|circle back|follow up|update you)\b/i,
  /\bcircle back (?:soon|later|shortly)\b/i,
  /\b(?:update|details?) (?:soon|shortly)\b/i,
  /\blet me (?:sort|check|look into|get back)\b/i,
  /\bplease allow me small\b/i,
];
const BLOCKED_REFUSAL_PATTERNS = [/\bi(?:'|’)m sorry,\s*but\s*i cannot assist with that request\.?\b/i];
const BLOCKED_REFUSAL_ERROR = "Blocked refusal phrase detected.";
const BLOCKED_REFUSAL_REPROMPT_LIMIT = 2;
const AWKWARD_CATCHPHRASE_PATTERNS = [/\bplease allow me\b/i, /\ballow me small\b/i];
const JOKE_INTENT_PATTERNS = [
  /\b(joke|banter|roast|pun|punchline)\b/i,
  /\b(lol|lmao|haha|hehe|lmfao)\b/i,
  /[😂🤣😹😆😅😄😁😜🤪🙃🔥💀]/,
  /\bwhy did\b/i,
  /\bknock knock\b/i,
];
const CRINGE_JOKE_PATTERNS = [
  /\bknock knock\b/i,
  /\bwhy did the\b/i,
  /\bdad joke\b/i,
  /\bpun intended\b/i,
  /\b(?:i(?:'|’)m|im) (?:so )?funny\b/i,
  /\btrust me[, ]+it(?:'|’)s funny\b/i,
  /\b(?:skibidi|gyatt|sigma|rizz)\b/i,
];
const JOKE_SIMILARITY_THRESHOLD = 0.62;
const JOKE_CHAIN_OUTBOUND_COOLDOWN = 2;
const CORE_HUMOR_PATTERN = /\b(lol|lmao|lmfao|rofl|haha|hehe|funny|joke|banter|meme|roast|hilarious)\b/i;
const CORE_HUMOR_EMOJI_PATTERN = /[😂🤣😹😆😄😁😅😜🤪🙃]/u;
const LOW_SIGNAL_HUMOR_KEYWORDS = new Set(["status", "story", "update", "wild", "dead"]);
const HUMOR_JUDGE_SYSTEM_INSTRUCTION =
  "You are a strict humor classifier for WhatsApp drafts. Output JSON only with: isJokeAttempt (boolean), isFunny (boolean), confidence (0..1), reason (string <= 140 chars).";

const STOPWORDS = new Set([
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
  "hi",
  "hey",
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

const DEFAULT_SYSTEM_INSTRUCTION =
  "You write human WhatsApp replies that sound like the user, preserve context, and avoid generic boilerplate.";
const DEFAULT_FUNNY_STATUS_KEYWORDS = [
  "lol",
  "lmao",
  "haha",
  "funny",
  "joke",
  "banter",
  "meme",
  "roast",
];
const DEFAULT_FUNNY_STATUS_EMOJIS = ["😂", "🤣", "😹", "😆", "😅", "😄", "😁", "😜", "🤪", "🙃"];
const HARD_STOP_PATTERNS = [
  /\b(stop texting|stop messaging|do not text|don't text|do not message|don't message)\b/i,
  /\b((?:abeg\s+)?no text me again|(?:abeg\s+)?no message me again)\b/i,
  /\b((?:abeg\s+)?no call me again|(?:abeg\s+)?no disturb me again)\b/i,
  /\b(don'?t hit me up|do not hit me up|stop hitting me up|lose my number)\b/i,
  /\b(stop blowing up my phone|quit texting me|unadd me|unsubscribe)\b/i,
  /\b(leave me alone|back off|no contact|don't contact me)\b/i,
  /\b(not interested|don't want to talk|do not want to talk|let'?s end this)\b/i,
];
const PAUSE_PATTERNS = [
  /\b(talk later|catch up later|we can continue later|pick this up later)\b/i,
  /\b(make we continue later|we go continue later|continue later abeg)\b/i,
  /\b(make i (?:call|text|ping) you later|i go (?:call|text|ping) you later)\b/i,
  /\b(i have to run|gotta run|gtg|brb|bbl|ttyl)\b/i,
  /\b(afk|hmu later|hit me up later|text you later|ping you later)\b/i,
  /\b(busy rn|in class rn|at work rn|in traffic rn)\b/i,
  /\b(i dey (?:road|class|work|traffic|wrk|trafic) rn)\b/i,
  /\b(i dey waka now|i dey commute now)\b/i,
  /\b(outside rn|outside right now|on the road|in transit)\b/i,
  /\b(i('|’)m busy|in a meeting|driving right now|about to sleep|heading out)\b/i,
];
const WRAP_UP_PATTERNS = [
  /^(ok|okay|cool|great|nice|perfect|all good|all gud|sounds good|done|resolved|all set|we good|we gud|bet+|say less+|k{1,4}|o+k+|works|copy|solid|valid|for sure|fs|fasho|word|heard|copy that|copy dat|sharp sharp|na so|ehen)[.!]*$/i,
  /^(thanks|thank you|thx|ty|tnx|thnks|tysm|that helps|got it|noted|understood|appreciate it|appreciate you)[.!]*$/i,
  /^(safe|safee|we move|we mov|no wahala|nwahala|sharp|copy o|na true|alright na|alrighty|alryt|all good sha|we good abeg|noted boss|thanks o|thank you o+|thx abeg|na so|ehen|sharp sharp)[.!]*$/i,
  /^(thanks|thank you|thx|ty|appreciate it|appreciate you)\s*,\s*(all good|we good|sounds good|got it|that helps|done|resolved|all set)[.!]*$/i,
  /^(bet+|say less+|kk|k|works|copy|solid|valid|all set|we good|for sure|fs|fasho|word|heard|copy that)[.!]*$/i,
];
const BOSS_ADDRESS_VOCATIVE_PATTERNS = [
  /^(?:hi|hey|hello|yo|dear|good\s+(?:morning|afternoon|evening))[\s,!.-]*(?:boss|oga|chairman)\b/i,
  /^(?:boss|oga|chairman)\b/i,
  /[,;]\s*(?:boss|oga|chairman)\b/i,
  /\b(?:boss|oga|chairman)\s*[!?.]*$/i,
];
const BOSS_ESCALATION_TITLES_EN = [
  "main boss",
  "big boss",
  "biggest boss",
  "boss of bosses",
  "top boss",
  "supreme boss",
  "main chairman",
  "chief chairman",
];
const BOSS_ESCALATION_TITLES_PIDGIN = [
  "main oga",
  "big oga",
  "grand oga",
  "oga at the top",
  "chairman",
  "chief chairman",
];
const BOSS_ESCALATION_PROMPT_TITLES = [...BOSS_ESCALATION_TITLES_EN, ...BOSS_ESCALATION_TITLES_PIDGIN]
  .slice(0, 10)
  .join(", ");
const ACK_ONLY_PATTERNS = [
  /^(ok|okay|sure|cool|great|perfect|nice|done|noted|got it|understood|alright|aight|ight|alrighty|alryt|k{1,4}|o+k+|bet+|say less+|works|copy|copy dat|solid|valid|all set|we good|we gud|for sure|fs|sounds good|all good|all gud|fasho|word|heard|copy that|na so|ehen|sharp sharp)[.!]*$/i,
  /^(thanks|thank you|thx|ty|tnx|thnks|tysm|appreciate it|appreciate you)[.!]*$/i,
  /^(safe|safee|we move|we mov|no wahala|nwahala|sharp|copy o|na true|alright na|all good sha|we good abeg|noted boss|thanks o|thank you o+|thx abeg|na so|ehen|sharp sharp)[.!]*$/i,
  /^(thanks|thank you|thx|ty|appreciate it|appreciate you|preciate you)(?:\s+\w{2,12})?[.!]*$/i,
  /^(thanks|thank you|thx|ty|appreciate it|appreciate you)\s*,\s*(all good|we good|sounds good|got it|that helps|done|resolved|all set)[.!]*$/i,
];

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0.72;
  }
  return Math.max(0, Math.min(value, 1));
}

function clampQualityThreshold(value: number | undefined, fallback = 0.72) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0.4, Math.min(value as number, 0.95));
}

function pickVariant(input: string, options: string[]) {
  if (options.length === 0) {
    return "";
  }
  const sum = [...input].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return options[sum % options.length];
}

function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countConfiguredHumorKeywordHits(text: string, keywords: string[]) {
  let hits = 0;
  for (const keyword of keywords) {
    const token = keyword.trim().toLowerCase();
    if (!token || LOW_SIGNAL_HUMOR_KEYWORDS.has(token)) {
      continue;
    }
    const pattern = new RegExp(`\\b${escapeRegex(token)}\\b`, "i");
    if (pattern.test(text)) {
      hits += 1;
    }
  }
  return hits;
}

function hasConfiguredHumorEmojiHit(text: string, emojis: string[]) {
  return emojis.some((emoji) => emoji && CORE_HUMOR_EMOJI_PATTERN.test(emoji) && text.includes(emoji));
}

function hasHumorSignal(text: string, keywords: string[], emojis: string[]) {
  const coreKeywordHit = CORE_HUMOR_PATTERN.test(text);
  const coreEmojiHit = CORE_HUMOR_EMOJI_PATTERN.test(text);
  const configuredKeywordHits = countConfiguredHumorKeywordHits(text, keywords);
  const configuredEmojiHit = hasConfiguredHumorEmojiHit(text, emojis);
  return coreKeywordHit || coreEmojiHit || configuredKeywordHits >= 2 || (configuredKeywordHits >= 1 && configuredEmojiHit);
}

function isAckLike(text: string) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 48) {
    return false;
  }
  if (/\?/.test(trimmed)) {
    return false;
  }
  return ACK_ONLY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function looksLoopingConversation(historyLines: string[]) {
  const recent = historyLines.slice(-10);
  if (recent.length < 4) {
    return false;
  }

  let outboundQuestions = 0;
  let inboundAckStreak = 0;
  let maxInboundAckStreak = 0;

  for (const line of recent) {
    if (line.startsWith("Me:") && /\?/.test(line)) {
      outboundQuestions += 1;
    }
    if (line.startsWith("Them:")) {
      const inbound = line.replace(/^Them:\s*/, "");
      if (isAckLike(inbound)) {
        inboundAckStreak += 1;
        maxInboundAckStreak = Math.max(maxInboundAckStreak, inboundAckStreak);
      } else {
        inboundAckStreak = 0;
      }
    }
  }

  return outboundQuestions >= 2 && maxInboundAckStreak >= 2;
}

export function detectConversationSteeringMode(args: {
  inboundText: string;
  historyLines: string[];
}): ConversationSteeringMode {
  const inbound = args.inboundText.trim();
  if (!inbound) {
    return "none";
  }

  if (HARD_STOP_PATTERNS.some((pattern) => pattern.test(inbound)) || hasPidginHardStopCue(inbound)) {
    return "hard_stop";
  }

  if (PAUSE_PATTERNS.some((pattern) => pattern.test(inbound)) || hasPidginPauseCue(inbound)) {
    return "pause";
  }

  if (isAckLike(inbound) && looksLoopingConversation(args.historyLines)) {
    return "loop";
  }

  if (WRAP_UP_PATTERNS.some((pattern) => pattern.test(inbound)) || hasPidginWrapUpCue(inbound) || isAckLike(inbound)) {
    return "wrap_up";
  }

  return "none";
}

export function detectPidginSignal(args: { inboundText: string; historyLines: string[] }) {
  return hasPidginSignal({
    inboundText: args.inboundText,
    historyLines: args.historyLines,
    threshold: 1.2,
  });
}

export function hasBossAddressCue(inboundText: string) {
  const text = normalizeOutboundText(inboundText || "");
  if (!text) {
    return false;
  }
  return BOSS_ADDRESS_VOCATIVE_PATTERNS.some((pattern) => pattern.test(text));
}

function pickBossEscalationTitle(inboundText: string, pidginMode: boolean) {
  const options = pidginMode ? BOSS_ESCALATION_TITLES_PIDGIN : BOSS_ESCALATION_TITLES_EN;
  return pickVariant(inboundText, options);
}

export function applyBossAddressEscalation(args: {
  inboundText: string;
  replyText: string;
  pidginMode?: boolean;
  allow?: boolean;
}) {
  const reply = normalizeOutboundText(args.replyText || "");
  if (!reply || args.allow === false || !hasBossAddressCue(args.inboundText)) {
    return reply;
  }

  const title = pickBossEscalationTitle(args.inboundText, Boolean(args.pidginMode));
  if (!title) {
    return reply;
  }

  if (new RegExp(`\\b${escapeRegex(title)}\\b`, "i").test(reply)) {
    return reply;
  }

  return normalizeOutboundText(`${title}, ${reply}`);
}

function steeringInstructionForMode(mode: ConversationSteeringMode) {
  if (mode === "hard_stop") {
    return "The latest message asks to end contact. Reply with one short, respectful acknowledgment and end the conversation. Do not ask follow-up questions.";
  }
  if (mode === "pause") {
    return "The latest message signals they are busy or want to continue later. Send a short sign-off that confirms the pause. Do not introduce new topics.";
  }
  if (mode === "loop") {
    return "The recent exchange is looping with low-signal acknowledgments. Give one concise closure line and stop extending the thread.";
  }
  if (mode === "wrap_up") {
    return "This exchange appears complete. Give a brief closing response and avoid adding new asks or follow-up questions.";
  }
  return "";
}

function heuristicReply(input: string, historyLines: string[] = []) {
  const steeringMode = detectConversationSteeringMode({
    inboundText: input,
    historyLines,
  });
  const pidginMode = detectPidginSignal({ inboundText: input, historyLines });
  const finalize = (candidate: string) =>
    applyBossAddressEscalation({
      inboundText: input,
      replyText: candidate,
      pidginMode,
      allow: steeringMode !== "hard_stop",
    });
  if (steeringMode === "hard_stop") {
    return finalize(
      pidginMode
        ? pickVariant(input, ["I hear you. I no go text again.", "Understood. I go leave am here.", "Okay, I go step back now."])
        : pickVariant(input, ["Understood. I'll leave it here.", "Got it, I'll step back now.", "Understood. I won't push this further."]),
    );
  }

  if (steeringMode === "pause") {
    return finalize(
      pidginMode
        ? pickVariant(input, ["No wahala, make we continue later.", "Sharp, we go yarn later.", "All good, ping me when you free."])
        : pickVariant(input, ["No worries, we can pick this up later.", "All good, let's continue later.", "Got you, we'll talk later."]),
    );
  }

  if (steeringMode === "loop" || steeringMode === "wrap_up") {
    return finalize(
      pidginMode
        ? pickVariant(input, ["Sharp, we good here.", "No wahala, talk later.", "Nice one, thanks for update."])
        : pickVariant(input, ["Perfect, we're good here.", "Sounds good, talk soon.", "Great, thanks for the update."]),
    );
  }

  const focus = input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !STOPWORDS.has(word))
    .slice(0, 4)
    .join(" ");

  if (/\bweird|odd|strange|robot|generic|template\b/i.test(input)) {
    return finalize(
      pidginMode
        ? pickVariant(input, [
            "You dey right, that one no sound natural. Make I answer well now.",
            "True talk, that reply weird small. I go keep am clear from here.",
            "Yeah, that one come out somehow. Make I reply proper now.",
          ])
        : pickVariant(input, [
            "You're right, that sounded off. I'll reply properly from here.",
            "Fair call, that reply was weird. I'll keep this one human and clear.",
            "Yeah, that came out weird. Let me answer you properly now.",
          ]),
    );
  }

  if (/\?|\b(can you|could you|when|where|what|why|how)\b/i.test(input)) {
    return finalize(
      pidginMode
        ? pickVariant(input, [
            "Yes, e go work. Give me small time make I send details.",
            "I fit do am. Make I sort am first, I go update you shortly.",
            "No wahala, I go handle am and send details soon.",
          ])
        : pickVariant(input, [
            "Yeah, that works on my side. Give me a bit and I'll send details shortly.",
            "Yep, I can do that. Let me sort it and get back to you shortly.",
            "That works. Give me a little time and I'll send the details.",
          ]),
    );
  }

  if (/\b(thanks|thank you)\b/i.test(input)) {
    return finalize(
      pidginMode
        ? pickVariant(input, ["Anytime.", "No wahala at all.", "I dey happy to help."])
        : pickVariant(input, ["Anytime.", "Always happy to help.", "No worries at all."]),
    );
  }

  if (/\b(sorry|apolog|my bad)\b/i.test(input)) {
    return finalize(
      pidginMode
        ? pickVariant(input, ["All good.", "No stress, we dey okay.", "You dey fine, no wahala."])
        : pickVariant(input, ["All good.", "No stress, we're good.", "You're fine, no worries."]),
    );
  }

  if (focus) {
    return finalize(
      pidginMode
        ? pickVariant(input, [
            `I hear you on ${focus}. Make I send clear reply now.`,
            `Thanks for flagging ${focus}. I go answer you properly now.`,
            `You dey right about ${focus}. Give me small time make I sort am.`,
          ])
        : pickVariant(input, [
            `I got you on ${focus}. Give me a moment and I'll send a clear reply.`,
            `Thanks for flagging ${focus}. I'll answer this properly now.`,
            `You're right about ${focus}. Let me respond clearly in a sec.`,
          ]),
    );
  }

  return finalize(
    pidginMode
      ? pickVariant(input, ["I don see your message. Give me small time make I reply well.", "Thanks for the nudge. I go respond proper now."])
      : pickVariant(input, ["I got your message. Give me a moment and I'll reply clearly.", "Thanks for the nudge. I'll respond properly now."]),
  );
}

const HISTORY_ACK_ONLY_PATTERNS = [
  /^(ok|okay|sure|cool|great|perfect|nice|done|noted|got it|understood|alright|aight|ight|alrighty|alryt|k{1,4}|o+k+|bet+|say less+|works|copy|copy dat|solid|valid|all set|we good|we gud|for sure|fs|sounds good|all good|all gud|fasho|word|heard|copy that)[.!]*$/i,
  /^(thanks|thank you|thx|ty|tnx|thnks|tysm|appreciate it|appreciate you)[.!]*$/i,
  /^(safe|safee|we move|we mov|no wahala|nwahala|sharp|copy o|na true|alright na|all good sha|we good abeg|noted boss|thanks o|thank you o+|thx abeg)[.!]*$/i,
  /^(thanks|thank you|thx|ty|appreciate it|appreciate you|preciate you)(?:\s+\w{2,12})?[.!]*$/i,
  /^(thanks|thank you|thx|ty|appreciate it|appreciate you)\s*,\s*(all good|we good|sounds good|got it|that helps|done|resolved|all set)[.!]*$/i,
  /^[🙏👍❤️😂🤣😅🔥💀]+$/,
];
const DEFAULT_MAX_CONTEXT_TOKENS = 8192;
const DEFAULT_CONTEXT_SEARCH_LIMIT = 4;
const DEFAULT_CONTEXT_LINE_CHAR_LIMIT = 220;

type IndexedHistoryLine = {
  index: number;
  line: string;
  body: string;
  normalized: string;
};

type PromptBuildResult = {
  prompt: string;
  contextToolCalls: ContextToolCall[];
  contextWindow: ContextWindowStats;
};

type HistorySearchOverride = {
  lines: string[];
  candidateCount: number;
  semanticRerankCount: number;
  confidence: number;
  retrievalStage?: "lexical" | "semantic" | "semantic_fallback";
};

type ContextWindowDetectionInput = {
  prompt: string;
  maxContextTokens: number;
  reserveOutputTokens: number;
  usedHistoryLines: number;
  relevantHistoryLines: number;
};

type ContextWindowCleaningInput = {
  historyLines: string[];
  historyLineLimit: number;
  maxLineChars: number;
};

type ConversationSearchInput = {
  historyLines: IndexedHistoryLine[];
  query: string;
  limit: number;
};

function parseBoundedNumber(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.round(Math.max(min, Math.min(parsed, max)));
}

function estimateTokenCount(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) {
    return 0;
  }
  return Math.ceil(compact.length / 4);
}

function countWords(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function parseHistoryLine(rawLine: string) {
  const normalized = rawLine.replace(/\s+/g, " ").trim();
  const meMatch = normalized.match(/^Me:\s*(.*)$/i);
  if (meMatch) {
    return {
      label: "Me",
      body: meMatch[1].trim(),
    };
  }
  const themMatch = normalized.match(/^Them:\s*(.*)$/i);
  if (themMatch) {
    return {
      label: "Them",
      body: themMatch[1].trim(),
    };
  }
  return {
    label: "Them",
    body: normalized,
  };
}

function compactHistoryLine(line: string, maxChars: number) {
  if (line.length <= maxChars) {
    return line;
  }
  return `${line.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function isLowSignalHistoryBody(body: string) {
  const trimmed = body.trim();
  if (!trimmed) {
    return true;
  }
  if (trimmed.length > 42) {
    return false;
  }
  return HISTORY_ACK_ONLY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function runContextWindowCleaningTool(args: ContextWindowCleaningInput) {
  const startedAt = Date.now();
  const cappedLimit = Math.round(Math.max(4, Math.min(args.historyLineLimit * 3, 120)));
  const maxLineChars = Math.round(Math.max(80, Math.min(args.maxLineChars, 800)));
  const dedupe = new Set<string>();
  const cleanedReversed: IndexedHistoryLine[] = [];

  for (let index = args.historyLines.length - 1; index >= 0; index -= 1) {
    const rawLine = args.historyLines[index] || "";
    const { label, body } = parseHistoryLine(rawLine);
    const compactBody = compactHistoryLine(body.replace(/\s+/g, " ").trim(), maxLineChars);
    if (!compactBody) {
      continue;
    }
    const normalized = `${label.toLowerCase()}:${compactBody.toLowerCase()}`;
    if (dedupe.has(normalized)) {
      continue;
    }
    dedupe.add(normalized);
    cleanedReversed.push({
      index,
      line: `${label}: ${compactBody}`,
      body: compactBody,
      normalized,
    });
    if (cleanedReversed.length >= cappedLimit) {
      break;
    }
  }

  const deduped = cleanedReversed.reverse();
  const keepLowSignalFromIndex = Math.max(0, deduped.length - 6);
  const filtered = deduped.filter((line, idx) => idx >= keepLowSignalFromIndex || !isLowSignalHistoryBody(line.body));

  const bounded = filtered.slice(-cappedLimit);
  const removedCount = args.historyLines.length - bounded.length;
  const latencyMs = Date.now() - startedAt;

  return {
    cleaned: bounded,
    call: {
      name: "context_window_cleaning" as const,
      latencyMs,
      input: {
        inputHistoryLines: args.historyLines.length,
        historyLineLimit: args.historyLineLimit,
        maxLineChars,
      },
      output: {
        cleanedHistoryLines: bounded.length,
        removedCount: Math.max(0, removedCount),
      },
    },
  };
}

function runConversationHistorySearchTool(args: ConversationSearchInput) {
  const startedAt = Date.now();
  const limit = Math.round(Math.max(1, Math.min(args.limit, 8)));
  const queryKeywords = Array.from(new Set(extractKeywords(args.query))).slice(0, 24);
  const maxIndex = Math.max(1, args.historyLines[args.historyLines.length - 1]?.index ?? 1);

  const scored = args.historyLines
    .map((entry) => {
      const bodyKeywords = new Set(extractKeywords(entry.body));
      let overlap = 0;
      for (const keyword of queryKeywords) {
        if (bodyKeywords.has(keyword)) {
          overlap += 1;
        }
      }
      const overlapScore = overlap * 2;
      const recencyScore = (Math.min(entry.index, maxIndex) / maxIndex) * 0.8;
      const lowSignalPenalty = isLowSignalHistoryBody(entry.body) ? 0.6 : 0;
      const score = overlapScore + recencyScore - lowSignalPenalty;
      return {
        index: entry.index,
        score,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index);

  const hitIndexSet = new Set(scored.map((item) => item.index));
  const hits = args.historyLines.filter((entry) => hitIndexSet.has(entry.index));
  const latencyMs = Date.now() - startedAt;

  return {
    hits,
    call: {
      name: "conversation_history_search" as const,
      latencyMs,
      input: {
        queryKeywords: queryKeywords.slice(0, 12),
        searchedHistoryLines: args.historyLines.length,
        limit,
      },
      output: {
        hits: hits.length,
      },
    },
  };
}

function runContextWindowDetectionTool(args: ContextWindowDetectionInput) {
  const startedAt = Date.now();
  const maxContextTokens = Math.max(512, Math.min(args.maxContextTokens, 200_000));
  const reserveOutputTokens = Math.max(64, Math.min(args.reserveOutputTokens, Math.floor(maxContextTokens * 0.5)));
  const availablePromptTokens = Math.max(128, maxContextTokens - reserveOutputTokens);
  const estimatedPromptTokens = estimateTokenCount(args.prompt);
  const overflowTokens = Math.max(0, estimatedPromptTokens - availablePromptTokens);
  const latencyMs = Date.now() - startedAt;

  const stats: ContextWindowStats = {
    estimatedPromptTokens,
    maxContextTokens,
    reserveOutputTokens,
    overflowTokens,
    usedHistoryLines: args.usedHistoryLines,
    relevantHistoryLines: args.relevantHistoryLines,
  };

  return {
    stats,
    call: {
      name: "context_window_detection" as const,
      latencyMs,
      input: {
        maxContextTokens,
        reserveOutputTokens,
        usedHistoryLines: args.usedHistoryLines,
        relevantHistoryLines: args.relevantHistoryLines,
      },
      output: {
        estimatedPromptTokens,
        availablePromptTokens,
        overflowTokens,
      },
    },
  };
}

function buildPrompt(args: {
  inboundText: string;
  historyLines: string[];
  historySearchOverride?: HistorySearchOverride;
  styleHints: string[];
  styleProfile?: StyleProfileContext;
  personality?: PersonalityContext;
  grounding?: GroundingContext;
  runtime?: RuntimeAiTuning;
}): PromptBuildResult {
  const historyLineLimit = Math.round(Math.max(4, Math.min(args.runtime?.historyLineLimit ?? 14, 40)));
  const contextSearchLineLimit = Math.round(
    Math.max(1, Math.min(args.runtime?.contextSearchLineLimit ?? DEFAULT_CONTEXT_SEARCH_LIMIT, 8)),
  );
  const maxContextTokens = Math.round(
    Math.max(
      512,
      Math.min(
        args.runtime?.maxContextTokens ??
          parseBoundedNumber(process.env.SLM_AI_MAX_CONTEXT_TOKENS, DEFAULT_MAX_CONTEXT_TOKENS, 512, 200_000),
        200_000,
      ),
    ),
  );
  const reserveOutputTokens = Math.round(
    Math.max(
      64,
      Math.min(
        args.runtime?.contextReserveTokens ??
          args.runtime?.maxOutputTokens ??
          parseBoundedNumber(process.env.SLM_AI_CONTEXT_RESERVE_TOKENS, 220, 64, 40_000),
        Math.floor(maxContextTokens * 0.5),
      ),
    ),
  );
  const toolCalls: ContextToolCall[] = [];

  const cleanedHistory = runContextWindowCleaningTool({
    historyLines: args.historyLines,
    historyLineLimit,
    maxLineChars: DEFAULT_CONTEXT_LINE_CHAR_LIMIT,
  });
  toolCalls.push(cleanedHistory.call);

  let historySearchHits: IndexedHistoryLine[] = [];
  if (args.historySearchOverride) {
    const externalStart = Date.now();
    const externalHits = (args.historySearchOverride.lines || [])
      .map((raw, index) => {
        const { label, body } = parseHistoryLine(raw);
        const line = `${label}: ${body}`.trim();
        if (!body) {
          return null;
        }
        return {
          index: cleanedHistory.cleaned.length + index,
          line,
          body,
          normalized: `${label.toLowerCase()}:${body.toLowerCase()}`,
        } as IndexedHistoryLine;
      })
      .filter((line): line is IndexedHistoryLine => Boolean(line))
      .slice(0, contextSearchLineLimit);

    const externalConfidence = Math.max(0, Math.min(args.historySearchOverride.confidence || 0, 1));
    const retrievalStage = args.historySearchOverride.retrievalStage || "semantic";
    const shouldSupplementLocal =
      externalHits.length < contextSearchLineLimit || externalConfidence < 0.45 || retrievalStage === "semantic_fallback";

    historySearchHits = externalHits;
    toolCalls.push({
      name: "conversation_history_search" as const,
      latencyMs: Date.now() - externalStart,
      input: {
        queryKeywords: Array.from(new Set(extractKeywords(args.inboundText))).slice(0, 12),
        searchedHistoryLines: cleanedHistory.cleaned.length,
        limit: contextSearchLineLimit,
        source: "external",
      },
      output: {
        hits: externalHits.length,
        candidateCount: Math.max(0, Math.round(args.historySearchOverride.candidateCount || 0)),
        semanticRerankCount: Math.max(0, Math.round(args.historySearchOverride.semanticRerankCount || 0)),
        confidence: externalConfidence,
        retrievalStage,
        localSupplementUsed: shouldSupplementLocal,
      },
    });

    if (shouldSupplementLocal) {
      const localSearch = runConversationHistorySearchTool({
        historyLines: cleanedHistory.cleaned,
        query: args.inboundText,
        limit: contextSearchLineLimit,
      });
      const existingNormalized = new Set(historySearchHits.map((line) => line.normalized));
      const supplementalHits = localSearch.hits.filter((line) => !existingNormalized.has(line.normalized));
      historySearchHits = [...historySearchHits, ...supplementalHits].slice(0, contextSearchLineLimit);

      toolCalls.push({
        ...localSearch.call,
        input: {
          ...localSearch.call.input,
          source: "local_supplement",
        },
        output: {
          ...localSearch.call.output,
          candidateCount: cleanedHistory.cleaned.length,
          semanticRerankCount: 0,
          confidence: Math.max(0, Math.min(localSearch.hits.length / Math.max(contextSearchLineLimit, 1), 1)),
          retrievalStage: "lexical",
          supplementalHits: supplementalHits.length,
          mergedHits: historySearchHits.length,
        },
      });
    }
  } else {
    const localSearch = runConversationHistorySearchTool({
      historyLines: cleanedHistory.cleaned,
      query: args.inboundText,
      limit: contextSearchLineLimit,
    });
    historySearchHits = localSearch.hits;
    toolCalls.push({
      ...localSearch.call,
      output: {
        ...localSearch.call.output,
        candidateCount: cleanedHistory.cleaned.length,
        semanticRerankCount: 0,
        confidence: Math.max(0, Math.min(localSearch.hits.length / Math.max(contextSearchLineLimit, 1), 1)),
        retrievalStage: "lexical",
      },
    });
  }

  let recentHistory = cleanedHistory.cleaned.slice(-historyLineLimit);
  let relevantHistory = historySearchHits
    .filter((hit) => !recentHistory.some((recent) => recent.index === hit.index))
    .slice(-contextSearchLineLimit);

  const outboundSamples = cleanedHistory.cleaned
    .filter((line) => line.line.startsWith("Me:"))
    .slice(-4)
    .map((line) => line.line.replace(/^Me:\s*/, "").trim())
    .filter(Boolean)
    .join(" | ");
  const mimicryLevel = clamp01(args.styleProfile?.mimicryLevel ?? 0.72);
  const mimicryInstruction =
    mimicryLevel >= 0.85
      ? "Strongly mirror the user's wording, rhythm, and punctuation."
      : mimicryLevel >= 0.6
        ? "Moderately mirror the user's wording and rhythm while staying clear."
        : "Use a friendly, clear baseline voice with light mirroring.";
  const hints = [
    ...args.styleHints,
    ...(args.styleProfile?.humorNotes || []),
    ...(args.styleProfile?.punctuationStyle || []),
    ...(args.styleProfile?.spellingNotes || []),
  ]
    .filter(Boolean)
    .slice(0, 12)
    .join(", ");
  const phrases = sanitizeCommonPhrasesForPrompt(args.styleProfile?.commonPhrases || []).join(", ");
  const personalityIntensity = clamp01(args.personality?.intensity ?? 0.6);
  const personalityLevelInstruction =
    personalityIntensity >= 0.85
      ? "Apply the selected personality strongly and consistently."
      : personalityIntensity >= 0.6
        ? "Apply the selected personality moderately while staying natural."
        : "Apply the selected personality lightly and keep responses neutral-first.";
  const personalityLabel = args.personality?.profileName || args.personality?.profileSlug || "";
  const activePersonaPack = resolveActivePersonaPack(args.runtime, args.personality);
  const personaPackShortcuts = activePersonaPack
    ? activePersonaPack.shortcutDictionary
        .slice(0, 10)
        .map((entry) => `${entry.token}: ${entry.usageRule}`)
        .join(" | ")
    : "";
  const personaPackGuardrails = activePersonaPack ? activePersonaPack.guardrails.slice(0, 6).join(" | ") : "";
  const personaPackFewShots = activePersonaPack ? selectFewShotsForPrompt(activePersonaPack, 900) : [];
  const personaPackFewShotText =
    personaPackFewShots.length > 0
      ? personaPackFewShots
          .map((example, index) => `${index + 1}. IN: ${example.inbound}\nOUT: ${example.reply}`)
          .join("\n\n")
      : "";
  const replyPolicyInstruction =
    args.runtime?.replyPolicyInstruction ||
    process.env.SLM_AI_REPLY_POLICY ||
    HARD_CODED_AZURE_DEFAULTS.replyPolicyInstruction ||
    "";
  const soulModeEnabled = args.runtime?.soulModeEnabled ?? true;
  const funnyKeywords = (args.runtime?.funnyStatusKeywords || DEFAULT_FUNNY_STATUS_KEYWORDS).slice(0, 30);
  const funnyEmojis = (args.runtime?.funnyStatusEmojis || DEFAULT_FUNNY_STATUS_EMOJIS).slice(0, 30);
  const playfulMoment = hasHumorSignal(args.inboundText, funnyKeywords, funnyEmojis);
  const soulInstruction = soulModeEnabled
    ? "Let the account owner's identity lead every reply. Keep the tone grounded and emotionally aware, and express their values, boundaries, and voice without sounding scripted."
    : "Use a neutral, practical tone and avoid playful language.";
  const playfulInstruction =
    soulModeEnabled && playfulMoment
      ? "The latest message is playful. A short, tasteful joke or witty line is allowed if it helps the conversation."
      : "";
  const jokeSafetyInstruction =
    soulModeEnabled && playfulMoment
      ? "Before using humor, silently confirm you have not already made a similar joke earlier in this chat. If a similar joke exists, do not reuse it. Also avoid cringe humor: no forced meme slang, no dad-joke setups, and no try-hard punchlines."
      : "";
  const antiJokeChainInstruction = hasRecentOutboundJokeInCooldown(args.historyLines, JOKE_CHAIN_OUTBOUND_COOLDOWN)
    ? `A joke was already used in the last ${JOKE_CHAIN_OUTBOUND_COOLDOWN} outbound replies. Do not continue the bit; reply directly without humor.`
    : "";
  const steeringMode = detectConversationSteeringMode({
    inboundText: args.inboundText,
    historyLines: recentHistory.map((line) => line.line),
  });
  const steeringInstruction = steeringInstructionForMode(steeringMode);
  const pidginMode = detectPidginSignal({
    inboundText: args.inboundText,
    historyLines: recentHistory.map((line) => line.line),
  });
  const pidginInstruction = buildPidginReplyInstruction(pidginMode);
  const bossEscalationInstruction = hasBossAddressCue(args.inboundText)
    ? `If the latest message addresses you as boss/oga/chairman, treat it as friendly local banter, not hierarchy. Lightly mirror once by calling them a playful upgraded title (examples: ${BOSS_ESCALATION_PROMPT_TITLES}). Keep it subtle, respectful, and use it at most once in the reply.`
    : "";

  const buildPromptText = () =>
    [
      "You are writing one WhatsApp reply as the account owner.",
      "Write like a real person: warm, calm, confident, and practical.",
      "Prefer one concise line. Only use a second short line when it clearly adds needed context.",
      "Sound conversational and specific, never stiff or corporate.",
      "Directly react to something concrete in the latest inbound message (topic, emotion, or request).",
      "Do not mention AI, policies, prompt rules, or internal reasoning.",
      "Do not overpromise. If timing is uncertain, say you'll confirm shortly.",
      "Do not prolong the conversation unnecessarily. If the intent is complete, close gracefully in one short line.",
      "Do not use emoji characters.",
      "Avoid direct name address by default. Only use the contact's name if they used your name first in the latest message or disambiguation is required.",
      "Avoid generic fillers like 'Noted', 'As an AI', 'I hope this message finds you well', or repetitive templates.",
      "Never send placeholder lines like 'Sounds good, I'll handle it and update you soon' or 'Got it, I'm on it.'",
      "Mimic style lightly: borrow tone, not exact catchphrases. If a remembered phrase sounds awkward, rewrite it in plain natural wording.",
      "Never use awkward stock phrases like 'please allow me small'.",
      soulInstruction,
      playfulInstruction,
      jokeSafetyInstruction,
      antiJokeChainInstruction,
      steeringInstruction,
      pidginInstruction,
      bossEscalationInstruction,
      replyPolicyInstruction ? `Additional reply policy: ${replyPolicyInstruction}` : "",
      mimicryInstruction,
      personalityLevelInstruction,
      personalityLabel ? `Selected relationship/personality mode: ${personalityLabel}` : "",
      args.personality?.profileDescription ? `Personality description: ${args.personality.profileDescription}` : "",
      args.personality?.profilePrompt ? `Personality behavior instruction: ${args.personality.profilePrompt}` : "",
      args.personality?.customPrompt ? `Thread-specific personality note: ${args.personality.customPrompt}` : "",
      args.personality?.threadPromptProfile
        ? `Conversation-specific prompt profile (${args.personality.threadPromptProfileSource || "manual"}): ${args.personality.threadPromptProfile}`
        : "",
      activePersonaPack ? `Active persona pack: ${activePersonaPack.id} (${activePersonaPack.name}).` : "",
      activePersonaPack ? `Persona pack master prompt: ${activePersonaPack.masterPrompt}` : "",
      personaPackShortcuts ? `Shortcut dictionary: ${personaPackShortcuts}` : "",
      personaPackGuardrails ? `Persona guardrails: ${personaPackGuardrails}` : "",
      personaPackFewShotText ? `Persona few-shot examples:\n${personaPackFewShotText}` : "",
      args.grounding?.myName ? `My preferred name in this thread: ${args.grounding.myName}` : "",
      args.grounding?.theirName
        ? `Contact preferred name in this thread (reference only; do not use unless needed): ${args.grounding.theirName}`
        : "",
      args.grounding?.autoAliases?.length ? `Known contact aliases: ${args.grounding.autoAliases.slice(0, 8).join(", ")}` : "",
      args.grounding?.vibeNotes ? `Conversation vibe notes: ${args.grounding.vibeNotes}` : "",
      hints ? `Style hints: ${hints}` : "",
      phrases ? `Optional lexical fingerprints (inspiration only, do not copy verbatim): ${phrases}` : "",
      outboundSamples ? `Recent sent-message examples: ${outboundSamples}` : "",
      relevantHistory.length > 0
        ? `Relevant earlier context matches:\n${relevantHistory.map((line) => line.line).join("\n")}`
        : "",
      recentHistory.length > 0 ? `Recent chat:\n${recentHistory.map((line) => line.line).join("\n")}` : "",
      `Latest inbound message: ${args.inboundText}`,
      "Return only the final reply text.",
    ]
      .filter(Boolean)
      .join("\n\n");

  let prompt = buildPromptText();
  let detection = runContextWindowDetectionTool({
    prompt,
    maxContextTokens,
    reserveOutputTokens,
    usedHistoryLines: recentHistory.length,
    relevantHistoryLines: relevantHistory.length,
  });
  toolCalls.push(detection.call);

  if (detection.stats.overflowTokens > 0) {
    const lineDropStep = Math.round(Math.max(1, Math.min(args.runtime?.contextOverflowLineDropStep ?? 2, 8)));
    const minHistoryLines = 1;
    while (detection.stats.overflowTokens > 0 && (recentHistory.length > minHistoryLines || relevantHistory.length > 0)) {
      if (recentHistory.length > minHistoryLines) {
        recentHistory = recentHistory.slice(Math.min(lineDropStep, recentHistory.length - minHistoryLines));
      } else {
        relevantHistory = relevantHistory.slice(0, -1);
      }
      prompt = buildPromptText();
      detection = runContextWindowDetectionTool({
        prompt,
        maxContextTokens,
        reserveOutputTokens,
        usedHistoryLines: recentHistory.length,
        relevantHistoryLines: relevantHistory.length,
      });
    }
    toolCalls.push({
      ...detection.call,
      input: {
        ...detection.call.input,
        mode: "post_trim",
      },
    });
  }

  return {
    prompt,
    contextToolCalls: toolCalls,
    contextWindow: detection.stats,
  };
}

function sanitizeReplyText(raw: string, maxChars = 320) {
  let text = raw.trim();
  text = text.replace(/^reply\s*[:\-]\s*/i, "").trim();
  text = text.replace(/^["'`]+|["'`]+$/g, "").trim();
  text = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  const boundedMaxChars = Math.round(Math.max(60, Math.min(maxChars, 1200)));
  if (text.length > boundedMaxChars) {
    text = text.slice(0, boundedMaxChars).trim();
  }

  return normalizeOutboundText(stripEmojiCharacters(text));
}

export function normalizeOutboundText(input: string) {
  let text = input
    .replace(/[—–]+/g, ", ")
    .replace(/\u2026/g, "...")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/[ \t]+(\n)/g, "$1")
    .trim();

  text = text
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();

  return text;
}

function firstNameToken(name?: string) {
  if (!name) {
    return "";
  }
  const [first = ""] = name.trim().split(/\s+/);
  const safe = first.replace(/[^\p{L}'-]/gu, "");
  if (safe.length < 2) {
    return "";
  }
  return safe;
}

function removeRepeatedDirectNameAddress(text: string, inboundText: string, theirName?: string) {
  const token = firstNameToken(theirName);
  if (!token) {
    return text;
  }

  const escaped = escapeRegex(token);
  const inboundUsesName = new RegExp(`\\b${escaped}\\b`, "i").test(inboundText);
  let next = text;

  // Strip most direct-address forms when inbound did not use the contact name.
  if (!inboundUsesName) {
    next = next.replace(new RegExp(`^(hey|hi|hello)\\s+${escaped}\\b(?:\\s*[,!:.-]\\s*|\\s+)`, "i"), "$1, ");
    next = next.replace(new RegExp(`^${escaped}\\b(?:\\s*[,!:.-]\\s*|\\s+)`, "i"), "");
    next = next.replace(new RegExp(`([.!?]\\s+|\\n+)(?:(?:hey|hi|hello)\\s+)?${escaped}\\b(?:\\s*[,!:.-]\\s*|\\s+)`, "gi"), "$1");
    next = next.replace(new RegExp(`,\\s*${escaped}\\b(?=\\s|[,.!?;:]|$)`, "gi"), "");
  }

  next = next.replace(
    new RegExp(`([.!?]\\s+|\\n+)(?:(?:hey|hi|hello)\\s+)?${escaped}\\b\\s*([,!:.-]\\s*)+`, "gi"),
    "$1",
  );

  let seenDirectAddress = false;
  next = next.replace(new RegExp(`\\b${escaped}\\b\\s*,\\s*`, "gi"), (match) => {
    if (!inboundUsesName) {
      return "";
    }
    if (seenDirectAddress) {
      return "";
    }
    seenDirectAddress = true;
    return match;
  });

  return next
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[,.;:!?]\s*/, "")
    .trim();
}

export function postProcessReplyText(args: {
  text: string;
  inboundText: string;
  historyLines?: string[];
  theirName?: string;
  fallbackText?: string;
}) {
  const fallback = (args.fallbackText || "All good.").trim() || "All good.";
  const withoutEmoji = stripEmojiCharacters(args.text || "");
  const withoutNameOveruse = removeRepeatedDirectNameAddress(withoutEmoji, args.inboundText, args.theirName);
  const pidginMode = detectPidginSignal({
    inboundText: args.inboundText,
    historyLines: args.historyLines || [],
  });
  const normalized = normalizeOutboundText(pidginMode ? normalizePidginFamilyTerms(withoutNameOveruse) : withoutNameOveruse);
  const steeringMode = detectConversationSteeringMode({
    inboundText: args.inboundText,
    historyLines: args.historyLines || [],
  });
  const withBossEscalation = applyBossAddressEscalation({
    inboundText: args.inboundText,
    replyText: normalized,
    pidginMode,
    allow: steeringMode !== "hard_stop",
  });
  return withBossEscalation || fallback;
}

function containsBlockedRefusalText(text: string) {
  const normalized = normalizeOutboundText(text).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }
  return BLOCKED_REFUSAL_PATTERNS.some((pattern) => pattern.test(normalized));
}

function pickConfigValue(...values: Array<string | undefined>) {
  for (const value of values) {
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function toAzureApiStyle(value: string | undefined): AzureApiStyle {
  if (value === "chat_completions" || value === "responses") {
    return value;
  }
  return "auto";
}

function inferAzureApiStyle(endpoint: string, configuredStyle: AzureApiStyle): Exclude<AzureApiStyle, "auto"> {
  if (configuredStyle !== "auto") {
    return configuredStyle;
  }
  if (/\/openai\/v1\/?$/i.test(endpoint)) {
    return "responses";
  }
  if (/\/responses(?:\?|$)/i.test(endpoint)) {
    return "responses";
  }
  return "chat_completions";
}

function buildAzureResponsesEndpoint(endpoint: string) {
  try {
    const parsed = new URL(endpoint);
    if (/\/responses\/?$/i.test(parsed.pathname)) {
      return parsed.toString();
    }
    if (/\/openai\/v1\/?$/i.test(parsed.pathname)) {
      parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/responses`;
      return parsed.toString();
    }
  } catch {
    // Keep original endpoint when URL parsing fails.
  }
  return endpoint;
}

function buildAzureChatCompletionsEndpoint(endpoint: string) {
  try {
    const parsed = new URL(endpoint);
    if (/\/chat\/completions\/?$/i.test(parsed.pathname)) {
      return parsed.toString();
    }
    if (/\/openai\/v1\/?$/i.test(parsed.pathname)) {
      parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/chat/completions`;
      return parsed.toString();
    }
  } catch {
    // Keep original endpoint when URL parsing fails.
  }
  return endpoint;
}

function getSystemInstruction() {
  return (
    pickConfigValue(process.env.AZURE_AI_SYSTEM_INSTRUCTION, HARD_CODED_AZURE_DEFAULTS.systemInstruction) ||
    DEFAULT_SYSTEM_INSTRUCTION
  );
}

function resolveFallbackMode(runtime?: RuntimeAiTuning): FallbackMode {
  const configured = runtime?.fallbackMode || process.env.SLM_AI_FALLBACK_MODE;
  return configured === "azure_only" ? "azure_only" : "all";
}

function normalizeTemperature(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return 0.7;
  }
  return Math.max(0, Math.min(value as number, 1.3));
}

function normalizeMaxOutputTokens(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return 140;
  }
  return Math.round(Math.max(40, Math.min(value as number, 1000)));
}

function extractKeywords(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

function isJokeLike(text: string) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 8) {
    return false;
  }
  return JOKE_INTENT_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function normalizeLineForComparison(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keywordJaccardSimilarity(left: string, right: string) {
  const leftKeywords = new Set(extractKeywords(left));
  const rightKeywords = new Set(extractKeywords(right));
  if (leftKeywords.size === 0 || rightKeywords.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const keyword of leftKeywords) {
    if (rightKeywords.has(keyword)) {
      intersection += 1;
    }
  }
  const union = leftKeywords.size + rightKeywords.size - intersection;
  if (union <= 0) {
    return 0;
  }
  return intersection / union;
}

function hasSimilarPriorOutboundJoke(text: string, historyLines: string[]) {
  const normalizedCandidate = normalizeLineForComparison(text);
  if (!normalizedCandidate) {
    return false;
  }

  for (const rawLine of historyLines) {
    const parsed = parseHistoryLine(rawLine);
    if (parsed.label !== "Me" || !isJokeLike(parsed.body)) {
      continue;
    }
    const normalizedPrior = normalizeLineForComparison(parsed.body);
    if (!normalizedPrior) {
      continue;
    }

    if (normalizedPrior === normalizedCandidate) {
      return true;
    }
    if (
      Math.min(normalizedPrior.length, normalizedCandidate.length) >= 24 &&
      (normalizedPrior.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedPrior))
    ) {
      return true;
    }
    if (keywordJaccardSimilarity(normalizedCandidate, normalizedPrior) >= JOKE_SIMILARITY_THRESHOLD) {
      return true;
    }
  }

  return false;
}

function hasRecentOutboundJokeInCooldown(historyLines: string[], cooldown: number) {
  let outboundSeen = 0;
  for (let index = historyLines.length - 1; index >= 0; index -= 1) {
    const parsed = parseHistoryLine(historyLines[index] || "");
    if (parsed.label !== "Me") {
      continue;
    }
    outboundSeen += 1;
    if (isJokeLike(parsed.body)) {
      return true;
    }
    if (outboundSeen >= cooldown) {
      break;
    }
  }
  return false;
}

function isCringeJoke(text: string) {
  return CRINGE_JOKE_PATTERNS.some((pattern) => pattern.test(text));
}

export function evaluateJokeGuardrail(text: string, historyLines: string[] = []): JokeGuardrailResult {
  if (!isJokeLike(text)) {
    return {
      blocked: false,
      reason: "",
      code: "none",
    };
  }
  if (isCringeJoke(text)) {
    return {
      blocked: true,
      reason: "Cringe joke pattern detected.",
      code: "cringe",
    };
  }
  if (hasSimilarPriorOutboundJoke(text, historyLines)) {
    return {
      blocked: true,
      reason: "Similar joke already used in this chat.",
      code: "similar_prior_joke",
    };
  }
  if (hasRecentOutboundJokeInCooldown(historyLines, JOKE_CHAIN_OUTBOUND_COOLDOWN)) {
    return {
      blocked: true,
      reason: `Recent joke already used in the last ${JOKE_CHAIN_OUTBOUND_COOLDOWN} outbound replies.`,
      code: "recent_joke_chain",
    };
  }
  return {
    blocked: false,
    reason: "",
    code: "none",
  };
}

function isLowValueReply(text: string, inboundText?: string) {
  if (containsBlockedRefusalText(text)) {
    return true;
  }

  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (LOW_VALUE_REPLY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const genericPhraseHit = LOW_VALUE_GENERIC_PHRASE_PATTERNS.some((pattern) => pattern.test(normalized));
  if (!genericPhraseHit) {
    return false;
  }

  const replyKeywords = new Set(extractKeywords(normalized));
  const inboundKeywords = new Set(extractKeywords(inboundText || ""));
  if (replyKeywords.size === 0 || inboundKeywords.size === 0) {
    return normalized.length < 140;
  }

  let shared = 0;
  for (const word of replyKeywords) {
    if (inboundKeywords.has(word)) {
      shared += 1;
    }
  }

  const overlap = shared / Math.max(replyKeywords.size, 1);
  return overlap < 0.2;
}

export function sanitizeCommonPhrasesForPrompt(phrases: string[]) {
  const cleaned: string[] = [];
  const seen = new Set<string>();

  for (const rawPhrase of phrases) {
    const phrase = rawPhrase.trim().replace(/\s+/g, " ");
    if (!phrase) {
      continue;
    }
    const normalized = phrase.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    if (LOW_VALUE_GENERIC_PHRASE_PATTERNS.some((pattern) => pattern.test(normalized))) {
      continue;
    }
    if (AWKWARD_CATCHPHRASE_PATTERNS.some((pattern) => pattern.test(normalized))) {
      continue;
    }

    seen.add(normalized);
    cleaned.push(phrase);
    if (cleaned.length >= 8) {
      break;
    }
  }

  return cleaned;
}

function resolveActivePersonaPack(runtime: RuntimeAiTuning | undefined, personality: PersonalityContext | undefined) {
  const pack = getPersonaPackById(runtime?.activePersonaPackId);
  if (!pack) {
    return null;
  }
  const slug = (personality?.profileSlug || "").trim().toLowerCase();
  if (!slug) {
    return null;
  }
  if (!pack.activation.allowedProfileSlugs.some((item) => item.toLowerCase() === slug)) {
    return null;
  }
  return pack;
}

function evaluateReplyQuality(args: {
  replyText: string;
  inboundText: string;
  historyLines: string[];
  pack: PersonaPack | null;
  threshold: number;
}) {
  const text = args.replyText.trim();
  const inbound = args.inboundText.trim();
  const replyKeywords = new Set(extractKeywords(text));
  const inboundKeywords = new Set(extractKeywords(inbound));
  let shared = 0;
  for (const token of replyKeywords) {
    if (inboundKeywords.has(token)) {
      shared += 1;
    }
  }

  const contextScore =
    inboundKeywords.size === 0
      ? 0.78
      : Math.max(0, Math.min(shared / Math.max(Math.min(inboundKeywords.size, 3), 1), 1));
  const shortcutTokens = (args.pack?.shortcutDictionary || []).map((item) => item.token.toLowerCase());
  const shortcutHits = shortcutTokens.filter((token) => token && new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text))
    .length;
  const naturalShortcutsScore =
    shortcutTokens.length === 0 ? 1 : shortcutHits === 0 ? 0.62 : shortcutHits <= 2 ? 1 : shortcutHits === 3 ? 0.68 : 0.32;
  const antiGenericScore = isLowValueReply(text, inbound) ? 0.08 : 1;
  const cringeHit = isCringeJoke(text) || /\b(skibidi|gyatt|sigma|rizz)\b/i.test(text);
  const repeatedPunctHit = /([!?])\1{3,}/.test(text);
  const antiCringeScore = cringeHit ? 0.05 : repeatedPunctHit ? 0.72 : 1;
  const words = countWords(text);
  const brevityScore = words < 2 ? 0.35 : words <= 24 ? 1 : words <= 36 ? 0.72 : 0.38;

  const defaultCriteria: Array<{ id: string; label: string; weight: number; description: string }> = [
    { id: "context_specificity", label: "Context Specificity", weight: 0.3, description: "Reply references inbound specifics." },
    { id: "natural_shortcuts", label: "Natural Shortcuts", weight: 0.2, description: "Shorthand usage feels organic." },
    { id: "anti_generic", label: "Anti-Generic", weight: 0.2, description: "Avoids canned template wording." },
    { id: "anti_cringe", label: "Anti-Cringe", weight: 0.2, description: "Avoids forced or awkward tone." },
    { id: "brevity_fit", label: "Brevity Fit", weight: 0.1, description: "Stays concise and natural." },
  ];
  const criteria = args.pack?.checklist.criteria.length ? args.pack.checklist.criteria : defaultCriteria;

  const scoreById: Record<string, number> = {
    context_specificity: contextScore,
    natural_shortcuts: naturalShortcutsScore,
    anti_generic: antiGenericScore,
    anti_cringe: antiCringeScore,
    brevity_fit: brevityScore,
  };

  const checks: QualityCheck[] = criteria.map((criterion) => {
    const score = clamp01(scoreById[criterion.id] ?? 0.75);
    return {
      id: criterion.id,
      label: criterion.label,
      score,
      passed: score >= 0.6,
      detail: criterion.description,
    };
  });

  let weightedScore = 0;
  for (const criterion of criteria) {
    const score = clamp01(scoreById[criterion.id] ?? 0.75);
    weightedScore += score * criterion.weight;
  }

  return {
    score: clamp01(weightedScore),
    passed: weightedScore >= args.threshold,
    checks,
  };
}

function shouldRunHumorJudge(text: string) {
  const trimmed = text.trim();
  if (trimmed.length < 8) {
    return false;
  }
  return isJokeLike(trimmed) || CORE_HUMOR_PATTERN.test(trimmed) || CORE_HUMOR_EMOJI_PATTERN.test(trimmed);
}

function buildHumorJudgePrompt(args: { candidateText: string; inboundText: string; historyLines: string[] }) {
  const recentHistory = args.historyLines.slice(-6).join("\n");
  return [
    HUMOR_JUDGE_SYSTEM_INSTRUCTION,
    "Assess whether the candidate is actually attempting humor, and if yes whether it is likely funny/natural (not forced).",
    "If candidate is not trying to be humorous, set isJokeAttempt=false and isFunny=false.",
    `Latest inbound message: ${args.inboundText}`,
    recentHistory ? `Recent chat context:\n${recentHistory}` : "",
    `Candidate reply: ${args.candidateText}`,
    'Return JSON only, e.g. {"isJokeAttempt":true,"isFunny":false,"confidence":0.83,"reason":"forced punchline"}',
  ]
    .filter(Boolean)
    .join("\n\n");
}

function parseHumorJudgeOutput(raw: string): Omit<HumorJudgment, "provider" | "model"> | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  const jsonText = objectStart >= 0 && objectEnd > objectStart ? trimmed.slice(objectStart, objectEnd + 1) : trimmed;
  try {
    const parsed = JSON.parse(jsonText) as {
      isJokeAttempt?: unknown;
      isFunny?: unknown;
      confidence?: unknown;
      reason?: unknown;
    };
    if (typeof parsed.isJokeAttempt !== "boolean" || typeof parsed.isFunny !== "boolean") {
      return null;
    }
    const confidenceRaw = Number(parsed.confidence);
    const confidence = Number.isFinite(confidenceRaw) ? clamp01(confidenceRaw) : 0.5;
    const reason =
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? normalizeOutboundText(parsed.reason).slice(0, 140)
        : "No reason provided.";
    return {
      isJokeAttempt: parsed.isJokeAttempt,
      isFunny: parsed.isFunny,
      confidence,
      reason,
    };
  } catch {
    return null;
  }
}

async function runHumorJudgeWithAzure(args: {
  candidateText: string;
  inboundText: string;
  historyLines: string[];
  runtime?: RuntimeAiTuning;
}): Promise<{ judgment?: HumorJudgment; attempts: AiAttempt[] }> {
  const cfg = getAzureConfig(args.runtime);
  const attempts: AiAttempt[] = [];
  const prompt = buildHumorJudgePrompt(args);
  if (!cfg.endpoint || !cfg.apiKey) {
    attempts.push({
      provider: "azure",
      stage: "humor_judge_azure",
      model: cfg.model,
      status: "error",
      latencyMs: 0,
      error: "Azure AI endpoint/key missing for humor judge.",
    });
    return { attempts };
  }

  const startedAt = Date.now();
  try {
    let rawText = "";
    if (cfg.apiStyle === "responses") {
      const response = await fetch(buildAzureResponsesEndpoint(cfg.endpoint), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": cfg.apiKey,
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          instructions: HUMOR_JUDGE_SYSTEM_INSTRUCTION,
          input: prompt,
          temperature: 0,
          max_output_tokens: 220,
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Azure humor judge failed (${response.status}): ${text.slice(0, 240)}`);
      }
      rawText = extractAzureResponsesText(await response.json());
    } else {
      const response = await fetch(buildAzureChatCompletionsEndpoint(cfg.endpoint), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": cfg.apiKey,
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            {
              role: "system",
              content: HUMOR_JUDGE_SYSTEM_INSTRUCTION,
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0,
          max_tokens: 220,
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Azure humor judge failed (${response.status}): ${text.slice(0, 240)}`);
      }
      rawText = extractAzureChatCompletionText(await response.json());
    }

    const parsed = parseHumorJudgeOutput(rawText);
    if (!parsed) {
      throw new Error(`Unable to parse humor judge JSON: ${rawText.slice(0, 200)}`);
    }
    attempts.push({
      provider: "azure",
      stage: "humor_judge_azure",
      model: cfg.model,
      status: "success",
      latencyMs: Date.now() - startedAt,
    });
    return {
      judgment: {
        ...parsed,
        provider: "azure",
        model: cfg.model,
      },
      attempts,
    };
  } catch (error) {
    attempts.push({
      provider: "azure",
      stage: "humor_judge_azure",
      model: cfg.model,
      status: "error",
      latencyMs: Date.now() - startedAt,
      error: toErrorMessage(error),
    });
    return { attempts };
  }
}

async function runHumorJudgeWithCodex(args: {
  candidateText: string;
  inboundText: string;
  historyLines: string[];
  runtime?: RuntimeAiTuning;
}): Promise<{ judgment?: HumorJudgment; attempts: AiAttempt[] }> {
  const codexPath = process.env.CODEX_CLI_PATH || "codex";
  const model = process.env.CODEX_FALLBACK_MODEL || "gpt-5.2";
  const outFile = join(tmpdir(), `slm-codex-humor-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
  const prompt = buildHumorJudgePrompt(args);
  const startedAt = Date.now();
  try {
    await execFileAsync(codexPath, ["exec", "--model", model, "--output-last-message", outFile, prompt], {
      timeout: Math.round(Math.max(20_000, Math.min(args.runtime?.codexTimeoutMs ?? 120_000, 300_000))),
      maxBuffer: 1024 * 1024,
    });
    const rawText = await fs.readFile(outFile, "utf8");
    await fs.unlink(outFile).catch(() => undefined);
    const parsed = parseHumorJudgeOutput(rawText);
    if (!parsed) {
      throw new Error(`Unable to parse codex humor judge JSON: ${rawText.slice(0, 200)}`);
    }
    return {
      judgment: {
        ...parsed,
        provider: "codex",
        model,
      },
      attempts: [
        {
          provider: "codex",
          stage: "humor_judge_codex",
          model,
          status: "success",
          latencyMs: Date.now() - startedAt,
        },
      ],
    };
  } catch (error) {
    await fs.unlink(outFile).catch(() => undefined);
    return {
      attempts: [
        {
          provider: "codex",
          stage: "humor_judge_codex",
          model,
          status: "error",
          latencyMs: Date.now() - startedAt,
          error: toErrorMessage(error),
        },
      ],
    };
  }
}

async function evaluateHumorWithAi(args: {
  candidateText: string;
  inboundText: string;
  historyLines: string[];
  runtime?: RuntimeAiTuning;
}): Promise<{ required: boolean; judgment?: HumorJudgment; attempts: AiAttempt[] }> {
  if (!shouldRunHumorJudge(args.candidateText)) {
    return {
      required: false,
      attempts: [],
    };
  }

  const attempts: AiAttempt[] = [];
  const azure = await runHumorJudgeWithAzure(args);
  attempts.push(...azure.attempts);
  if (azure.judgment) {
    return {
      required: true,
      judgment: azure.judgment,
      attempts,
    };
  }

  if (resolveFallbackMode(args.runtime) === "all") {
    const codex = await runHumorJudgeWithCodex(args);
    attempts.push(...codex.attempts);
    if (codex.judgment) {
      return {
        required: true,
        judgment: codex.judgment,
        attempts,
      };
    }
  }

  return {
    required: true,
    attempts,
  };
}

async function rewriteReplyOnce(args: {
  candidateText: string;
  inboundText: string;
  historyLines: string[];
  basePrompt: string;
  failedChecks: QualityCheck[];
  runtime?: RuntimeAiTuning;
  pack: PersonaPack | null;
}) {
  const failedCheckText = args.failedChecks
    .filter((check) => !check.passed)
    .slice(0, 4)
    .map((check) => `${check.label} (${Math.round(check.score * 100)}%)`)
    .join(", ");
  const rewriteInstruction = args.pack?.rewritePolicy.instruction || "Rewrite to be specific, concise, and natural.";
  const rewritePrompt = [
    args.basePrompt,
    `Current draft reply: ${args.candidateText}`,
    failedCheckText ? `Failed quality checks: ${failedCheckText}.` : "",
    rewriteInstruction,
    "Return only the revised reply text.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const attempts: AiAttempt[] = [];
  const azure = await runAzure(rewritePrompt, args.inboundText, args.historyLines, args.runtime);
  attempts.push(...azure.attempts);
  if (azure.result) {
    return { result: azure.result, attempts };
  }

  if (resolveFallbackMode(args.runtime) === "all") {
    const codex = await runCodex(rewritePrompt, args.inboundText, args.historyLines, args.runtime);
    attempts.push(...codex.attempts);
    if (codex.result) {
      return { result: codex.result, attempts };
    }
  }

  return { attempts };
}

async function rewriteJokeChainReplyOnce(args: {
  candidateText: string;
  inboundText: string;
  historyLines: string[];
  basePrompt: string;
  runtime?: RuntimeAiTuning;
}) {
  const rewritePrompt = [
    args.basePrompt,
    `Current draft reply: ${args.candidateText}`,
    `The last ${JOKE_CHAIN_OUTBOUND_COOLDOWN} outbound replies already include humor. Rewrite this into a direct, non-joke response.`,
    "Do not use banter, punchlines, meme slang, or playful callbacks in the rewrite.",
    "Stay concise, specific to the latest inbound message, and natural.",
    "Return only the revised reply text.",
  ].join("\n\n");

  const attempts: AiAttempt[] = [];
  const azure = await runAzure(rewritePrompt, args.inboundText, args.historyLines, args.runtime);
  attempts.push(...azure.attempts);
  if (azure.result) {
    return { result: azure.result, attempts };
  }

  if (resolveFallbackMode(args.runtime) === "all") {
    const codex = await runCodex(rewritePrompt, args.inboundText, args.historyLines, args.runtime);
    attempts.push(...codex.attempts);
    if (codex.result) {
      return { result: codex.result, attempts };
    }
  }

  return { attempts };
}

function extractAzureResponsesText(data: unknown) {
  if (!data || typeof data !== "object") {
    return "";
  }

  const direct = (data as { output_text?: unknown }).output_text;
  if (typeof direct === "string") {
    return direct;
  }

  if (Array.isArray(direct)) {
    return direct.filter((item): item is string => typeof item === "string").join("\n");
  }

  const output = (data as { output?: unknown }).output;
  if (!Array.isArray(output)) {
    return "";
  }

  return output
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) {
        return "";
      }
      return content
        .map((part) => {
          if (!part || typeof part !== "object") {
            return "";
          }
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        })
        .join("\n");
    })
    .filter(Boolean)
    .join("\n");
}

function extractAzureChatCompletionText(data: unknown) {
  if (!data || typeof data !== "object") {
    return "";
  }
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return "";
  }
  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    return "";
  }
  const message = (firstChoice as { message?: unknown }).message;
  if (!message || typeof message !== "object") {
    return "";
  }

  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== "object") {
          return "";
        }
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      })
      .join("\n");
  }

  return "";
}

function getAzureConfig(runtime?: RuntimeAiTuning): AzureConfig {
  const endpoint = pickConfigValue(
    process.env.AZURE_AI_ENDPOINT,
    process.env.AZURE_OPENAI_ENDPOINT,
    HARD_CODED_AZURE_DEFAULTS.endpoint,
  );
  const apiKey = pickConfigValue(
    process.env.AZURE_AI_API_KEY,
    process.env.AZURE_OPENAI_API_KEY,
    process.env.OPENAI_API_KEY,
    HARD_CODED_AZURE_DEFAULTS.apiKey,
  );
  const model =
    pickConfigValue(runtime?.model, process.env.AZURE_AI_MODEL, process.env.AZURE_OPENAI_MODEL, HARD_CODED_AZURE_DEFAULTS.model) ||
    "gpt-5.4";
  const configuredStyle = toAzureApiStyle(
    runtime?.apiStyle || process.env.AZURE_AI_API_STYLE || HARD_CODED_AZURE_DEFAULTS.apiStyle,
  );

  return {
    endpoint,
    apiKey,
    model,
    apiStyle: inferAzureApiStyle(endpoint, configuredStyle),
    systemInstruction: pickConfigValue(runtime?.systemInstruction, getSystemInstruction()) || DEFAULT_SYSTEM_INSTRUCTION,
    temperature: normalizeTemperature(runtime?.temperature),
    maxOutputTokens: normalizeMaxOutputTokens(runtime?.maxOutputTokens),
  };
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 300);
  }
  return String(error).slice(0, 300);
}

async function runAzure(
  prompt: string,
  inboundText: string,
  historyLines: string[],
  runtime?: RuntimeAiTuning,
): Promise<AttemptOutcome> {
  const cfg = getAzureConfig(runtime);
  const attempts: AiAttempt[] = [];
  const missingConfigStage: AiAttempt["stage"] = cfg.apiStyle === "responses" ? "azure_responses" : "azure_sdk";
  if (!cfg.endpoint || !cfg.apiKey) {
    attempts.push({
      provider: "azure",
      stage: missingConfigStage,
      model: cfg.model,
      status: "error",
      latencyMs: 0,
      error: "Azure AI endpoint/key missing.",
    });
    return { attempts };
  }

  const startAll = Date.now();
  const messages = [
    {
      role: "system",
      content: cfg.systemInstruction,
    },
    {
      role: "user",
      content: prompt,
    },
  ];

  if (cfg.apiStyle === "responses") {
    const responsesStart = Date.now();
    const responsesEndpoint = buildAzureResponsesEndpoint(cfg.endpoint);
    try {
      const response = await fetch(responsesEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": cfg.apiKey,
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          instructions: cfg.systemInstruction,
          input: prompt,
          temperature: cfg.temperature,
          max_output_tokens: cfg.maxOutputTokens,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Azure Responses failed (${response.status}): ${text.slice(0, 300)}`);
      }

      const raw = await response.json();
      const cleaned = sanitizeReplyText(extractAzureResponsesText(raw), runtime?.maxReplyChars);
      if (!cleaned) {
        throw new Error("Azure Responses returned empty response.");
      }
      if (containsBlockedRefusalText(cleaned)) {
        throw new Error(BLOCKED_REFUSAL_ERROR);
      }
      if (isLowValueReply(cleaned, inboundText)) {
        throw new Error("Azure Responses returned low-value canned text.");
      }

      attempts.push({
        provider: "azure",
        stage: "azure_responses",
        model: cfg.model,
        status: "success",
        latencyMs: Date.now() - responsesStart,
      });

      return {
        result: {
          text: cleaned,
          provider: "azure",
          model: cfg.model,
          latencyMs: Date.now() - startAll,
          guardrailBlocked: false,
        },
        attempts,
      };
    } catch (error) {
      attempts.push({
        provider: "azure",
        stage: "azure_responses",
        model: cfg.model,
        status: "error",
        latencyMs: Date.now() - responsesStart,
        error: toErrorMessage(error),
      });
      return { attempts };
    }
  }

  const sdkStart = Date.now();
  try {
    const client = ModelClient(cfg.endpoint, new AzureKeyCredential(cfg.apiKey));
    const response = await client.path("/chat/completions").post({
      body: {
        model: cfg.model,
        messages,
        max_tokens: cfg.maxOutputTokens,
        temperature: cfg.temperature,
      },
    });

    if (isUnexpected(response)) {
      throw new Error(`Azure AI SDK error: ${response.body.error?.message || response.status}`);
    }

    const content = response.body.choices?.[0]?.message?.content as unknown;
    let text = "";
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .map((part) => {
          if (part && typeof part === "object" && "text" in part) {
            return String((part as { text?: string }).text || "");
          }
          return "";
        })
        .join("\n");
    }

    const cleaned = sanitizeReplyText(text, runtime?.maxReplyChars);
    if (!cleaned) {
      throw new Error("Azure AI returned empty response.");
    }
    if (containsBlockedRefusalText(cleaned)) {
      throw new Error(BLOCKED_REFUSAL_ERROR);
    }
    if (isLowValueReply(cleaned, inboundText)) {
      throw new Error("Azure AI returned low-value canned text.");
    }

    attempts.push({
      provider: "azure",
      stage: "azure_sdk",
      model: cfg.model,
      status: "success",
      latencyMs: Date.now() - sdkStart,
    });

    return {
      result: {
        text: cleaned,
        provider: "azure",
        model: cfg.model,
        latencyMs: Date.now() - startAll,
        guardrailBlocked: false,
      },
      attempts,
    };
  } catch (error) {
    attempts.push({
      provider: "azure",
      stage: "azure_sdk",
      model: cfg.model,
      status: "error",
      latencyMs: Date.now() - sdkStart,
      error: toErrorMessage(error),
    });
  }

  // Fallback for environments where endpoint is a full REST URL instead of model client base URL.
  const httpStart = Date.now();
  try {
    const response = await fetch(cfg.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": cfg.apiKey,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: cfg.temperature,
        max_tokens: cfg.maxOutputTokens,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Azure AI failed (${response.status}): ${text.slice(0, 300)}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((p) => p.text || "").join("\n")
          : "";

    const cleaned = sanitizeReplyText(text, runtime?.maxReplyChars);
    if (!cleaned) {
      throw new Error("Azure AI returned empty response.");
    }
    if (containsBlockedRefusalText(cleaned)) {
      throw new Error(BLOCKED_REFUSAL_ERROR);
    }
    if (isLowValueReply(cleaned, inboundText)) {
      throw new Error("Azure AI returned low-value canned text.");
    }

    attempts.push({
      provider: "azure",
      stage: "azure_http",
      model: cfg.model,
      status: "success",
      latencyMs: Date.now() - httpStart,
    });

    return {
      result: {
        text: cleaned,
        provider: "azure",
        model: cfg.model,
        latencyMs: Date.now() - startAll,
        guardrailBlocked: false,
      },
      attempts,
    };
  } catch (error) {
    attempts.push({
      provider: "azure",
      stage: "azure_http",
      model: cfg.model,
      status: "error",
      latencyMs: Date.now() - httpStart,
      error: toErrorMessage(error),
    });
    return { attempts };
  }
}

function sanitizeImageAnalysisText(raw: string) {
  const cleaned = normalizeOutboundText(raw.replace(/^image analysis\s*[:\-]\s*/i, "").trim());
  if (!cleaned) {
    return "";
  }
  if (cleaned.length <= 640) {
    return cleaned;
  }
  return `${cleaned.slice(0, 637).trim()}...`;
}

function heuristicImageAnalysis(caption?: string) {
  const safeCaption = (caption || "").trim();
  if (safeCaption) {
    return `Image received. Caption says "${safeCaption}", but I could not analyze visual details right now.`;
  }
  return "Image received, but I could not analyze visual details right now.";
}

function buildImageAnalysisPrompt(caption?: string) {
  const captionLine = caption?.trim() ? `Sender caption: ${caption.trim()}` : "Sender caption: none";
  return [
    "Analyze this inbound WhatsApp image or screenshot.",
    "Return 2-4 short lines with: what is visible, any readable text, and the likely intent/context.",
    "If uncertain, say so briefly.",
    captionLine,
  ].join("\n");
}

export async function describeInboundImageWithFallback(args: {
  imageBytes: Buffer;
  mimeType?: string;
  caption?: string;
  runtime?: RuntimeAiTuning;
}): Promise<ImageAnalysisResult> {
  const cfg = getAzureConfig(args.runtime);
  const heuristic = (): ImageAnalysisResult => ({
    description: heuristicImageAnalysis(args.caption),
    provider: "heuristic",
    model: "heuristic-image-fallback",
    latencyMs: 0,
  });

  if (!cfg.endpoint || !cfg.apiKey) {
    return {
      ...heuristic(),
      error: "Azure AI endpoint/key missing.",
    };
  }

  if (!args.imageBytes || args.imageBytes.length === 0) {
    return {
      ...heuristic(),
      error: "Image payload is empty.",
    };
  }

  if (args.imageBytes.length > 6_000_000) {
    return {
      ...heuristic(),
      error: `Image too large for analysis (${args.imageBytes.length} bytes).`,
    };
  }

  const mimeType = (args.mimeType || "image/jpeg").trim().toLowerCase();
  const safeMimeType = /^image\/[a-z0-9.+-]+$/.test(mimeType) ? mimeType : "image/jpeg";
  const dataUrl = `data:${safeMimeType};base64,${args.imageBytes.toString("base64")}`;
  const prompt = buildImageAnalysisPrompt(args.caption);
  const start = Date.now();

  try {
    if (cfg.apiStyle === "responses") {
      const responsesEndpoint = buildAzureResponsesEndpoint(cfg.endpoint);
      const response = await fetch(responsesEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": cfg.apiKey,
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          instructions: "You are a concise visual assistant for inbound WhatsApp images.",
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: prompt,
                },
                {
                  type: "input_image",
                  image_url: dataUrl,
                },
              ],
            },
          ],
          temperature: Math.min(cfg.temperature, 0.4),
          max_output_tokens: Math.min(cfg.maxOutputTokens, 280),
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Azure image analysis failed (${response.status}): ${body.slice(0, 240)}`);
      }
      const data = await response.json();
      const description = sanitizeImageAnalysisText(extractAzureResponsesText(data));
      if (!description) {
        throw new Error("Azure image analysis returned empty text.");
      }
      return {
        description,
        provider: "azure",
        model: cfg.model,
        latencyMs: Date.now() - start,
      };
    }

    const chatEndpoint = buildAzureChatCompletionsEndpoint(cfg.endpoint);
    const response = await fetch(chatEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": cfg.apiKey,
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          {
            role: "system",
            content: "You are a concise visual assistant for inbound WhatsApp images.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: prompt,
              },
              {
                type: "image_url",
                image_url: {
                  url: dataUrl,
                },
              },
            ],
          },
        ],
        temperature: Math.min(cfg.temperature, 0.4),
        max_tokens: Math.min(cfg.maxOutputTokens, 280),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Azure image analysis failed (${response.status}): ${body.slice(0, 240)}`);
    }

    const data = await response.json();
    const description = sanitizeImageAnalysisText(extractAzureChatCompletionText(data));
    if (!description) {
      throw new Error("Azure image analysis returned empty text.");
    }

    return {
      description,
      provider: "azure",
      model: cfg.model,
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      ...heuristic(),
      latencyMs: Date.now() - start,
      error: toErrorMessage(error),
    };
  }
}

function buildAzureImageGenerationEndpoint(endpoint: string) {
  if (!endpoint) {
    return "";
  }
  try {
    const parsed = new URL(endpoint);
    if (/\/images\/generations\/?$/i.test(parsed.pathname)) {
      return parsed.toString();
    }
    if (/\/responses\/?$/i.test(parsed.pathname)) {
      parsed.pathname = parsed.pathname.replace(/\/responses\/?$/i, "/images/generations");
      return parsed.toString();
    }
    if (/\/chat\/completions\/?$/i.test(parsed.pathname)) {
      parsed.pathname = parsed.pathname.replace(/\/chat\/completions\/?$/i, "/images/generations");
      return parsed.toString();
    }
    if (/\/openai\/v1\/?$/i.test(parsed.pathname)) {
      parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/images/generations`;
      return parsed.toString();
    }
    return endpoint;
  } catch {
    return endpoint;
  }
}

function buildMemeImagePrompt(args: {
  inboundText: string;
  recentHistoryLines: string[];
  styleHints?: string[];
  threadTitle?: string;
}) {
  const history = args.recentHistoryLines
    .slice(-8)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  const hints = (args.styleHints || [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6)
    .join(" | ");
  const threadLabel = (args.threadTitle || "this chat").trim();

  return [
    `Create a witty reaction meme image for ${threadLabel}.`,
    "Style: friendly, tasteful, not offensive, and modern social-chat meme tone.",
    "No watermarks, no logos, no political content, no explicit content.",
    "Keep text short and readable (max two short lines), high contrast, square composition.",
    "Reference the latest message and chat vibe below.",
    `Latest inbound: ${args.inboundText}`,
    history ? `Recent chat context:\n${history}` : "",
    hints ? `Style hints: ${hints}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function getAzureImageConfig(runtime?: RuntimeAiTuning) {
  const endpoint = pickConfigValue(
    process.env.AZURE_AI_IMAGE_ENDPOINT,
    process.env.AZURE_AI_ENDPOINT,
    process.env.AZURE_OPENAI_ENDPOINT,
  );
  const apiKey = pickConfigValue(
    process.env.AZURE_AI_IMAGE_API_KEY,
    process.env.AZURE_AI_API_KEY,
    process.env.AZURE_OPENAI_API_KEY,
    process.env.OPENAI_API_KEY,
  );
  const model = pickConfigValue(process.env.AZURE_AI_IMAGE_MODEL, runtime?.model, process.env.AZURE_AI_MODEL) || "gpt-image-1";
  return {
    endpoint: buildAzureImageGenerationEndpoint(endpoint),
    apiKey,
    model,
  };
}

async function extractImageBytesFromGenerationPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }
  const first = data[0];
  if (!first || typeof first !== "object") {
    return null;
  }

  const b64 =
    ((first as { b64_json?: unknown }).b64_json as string | undefined) ||
    ((first as { b64?: unknown }).b64 as string | undefined);
  if (typeof b64 === "string" && b64.trim()) {
    try {
      return {
        imageBytes: Buffer.from(b64, "base64"),
        mimeType: "image/png",
      };
    } catch {
      return null;
    }
  }

  const imageUrl = ((first as { url?: unknown }).url as string | undefined) || "";
  if (imageUrl) {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      return null;
    }
    const mimeType = response.headers.get("content-type") || "image/png";
    return {
      imageBytes: Buffer.from(await response.arrayBuffer()),
      mimeType: mimeType.split(";")[0]?.trim() || "image/png",
    };
  }

  return null;
}

export async function generateMemeImageWithAzure(args: {
  inboundText: string;
  recentHistoryLines: string[];
  styleHints?: string[];
  threadTitle?: string;
  runtime?: RuntimeAiTuning;
}): Promise<MemeImageGenerationResult> {
  const cfg = getAzureImageConfig(args.runtime);
  const prompt = buildMemeImagePrompt({
    inboundText: args.inboundText,
    recentHistoryLines: args.recentHistoryLines,
    styleHints: args.styleHints,
    threadTitle: args.threadTitle,
  });
  const promptHash = createHash("sha256").update(prompt).digest("hex");
  const start = Date.now();

  if (!cfg.endpoint || !cfg.apiKey) {
    return {
      mimeType: "image/png",
      prompt,
      promptHash,
      provider: "azure",
      model: cfg.model,
      latencyMs: 0,
      error: "Azure image generation endpoint/key missing.",
    };
  }

  try {
    const response = await fetch(cfg.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": cfg.apiKey,
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        prompt,
        size: "1024x1024",
        quality: "medium",
        response_format: "b64_json",
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Azure meme generation failed (${response.status}): ${body.slice(0, 280)}`);
    }
    const payload = await response.json();
    const extracted = await extractImageBytesFromGenerationPayload(payload);
    if (!extracted || extracted.imageBytes.length === 0) {
      throw new Error("Azure meme generation returned empty image payload.");
    }

    return {
      imageBytes: extracted.imageBytes,
      mimeType: extracted.mimeType,
      prompt,
      promptHash,
      provider: "azure",
      model: cfg.model,
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      mimeType: "image/png",
      prompt,
      promptHash,
      provider: "azure",
      model: cfg.model,
      latencyMs: Date.now() - start,
      error: toErrorMessage(error),
    };
  }
}

async function runCodex(
  prompt: string,
  inboundText: string,
  historyLines: string[],
  runtime?: RuntimeAiTuning,
): Promise<AttemptOutcome> {
  const codexPath = process.env.CODEX_CLI_PATH || "codex";
  const model = process.env.CODEX_FALLBACK_MODEL || "gpt-5.2";
  const outFile = join(tmpdir(), `slm-codex-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
  const start = Date.now();
  try {
    await execFileAsync(codexPath, ["exec", "--model", model, "--output-last-message", outFile, prompt], {
      timeout: Math.round(Math.max(20_000, Math.min(runtime?.codexTimeoutMs ?? 120_000, 300_000))),
      maxBuffer: 1024 * 1024,
    });

    const text = sanitizeReplyText(await fs.readFile(outFile, "utf8"), runtime?.maxReplyChars);
    await fs.unlink(outFile).catch(() => undefined);

    if (!text) {
      throw new Error("Codex fallback returned empty output.");
    }
    if (containsBlockedRefusalText(text)) {
      throw new Error(BLOCKED_REFUSAL_ERROR);
    }
    if (isLowValueReply(text, inboundText)) {
      throw new Error("Codex fallback returned low-value canned text.");
    }

    const latencyMs = Date.now() - start;
    return {
      result: {
        text,
        provider: "codex",
        model,
        latencyMs,
        guardrailBlocked: false,
      },
      attempts: [
        {
          provider: "codex",
          stage: "codex_cli",
          model,
          status: "success",
          latencyMs,
        },
      ],
    };
  } catch (error) {
    await fs.unlink(outFile).catch(() => undefined);
    return {
      attempts: [
        {
          provider: "codex",
          stage: "codex_cli",
          model,
          status: "error",
          latencyMs: Date.now() - start,
          error: toErrorMessage(error),
        },
      ],
    };
  }
}

function isBlockedRefusalAttempt(attempt?: AiAttempt) {
  if (!attempt || attempt.status !== "error") {
    return false;
  }
  return (attempt.error || "").toLowerCase().includes(BLOCKED_REFUSAL_ERROR.toLowerCase());
}

function buildBlockedRefusalRepromptPrompt(basePrompt: string, inboundText: string, retryNumber: number) {
  return [
    basePrompt,
    `Retry ${retryNumber}: The previous draft used a blocked refusal template.`,
    "Generate a fresh, context-specific WhatsApp reply that directly addresses the latest inbound message.",
    `Do not output this sentence (or close variants): "I'm sorry, but I cannot assist with that request."`,
    "Do not apologize for inability to help.",
    `Latest inbound message to address: ${inboundText}`,
    "Return only the final reply text.",
  ].join("\n\n");
}

async function runWithBlockedRefusalReprompts(args: {
  basePrompt: string;
  inboundText: string;
  run: (prompt: string) => Promise<AttemptOutcome>;
  maxReprompts?: number;
}) {
  const allAttempts: AiAttempt[] = [];
  const maxReprompts = Math.round(Math.max(0, Math.min(args.maxReprompts ?? BLOCKED_REFUSAL_REPROMPT_LIMIT, 4)));
  let prompt = args.basePrompt;

  for (let retry = 0; retry <= maxReprompts; retry += 1) {
    const outcome = await args.run(prompt);
    allAttempts.push(...outcome.attempts);
    if (outcome.result) {
      return {
        result: outcome.result,
        attempts: allAttempts,
        promptUsed: prompt,
      };
    }

    const lastAttempt = outcome.attempts[outcome.attempts.length - 1];
    if (!isBlockedRefusalAttempt(lastAttempt) || retry >= maxReprompts) {
      break;
    }
    prompt = buildBlockedRefusalRepromptPrompt(args.basePrompt, args.inboundText, retry + 1);
  }

  return {
    attempts: allAttempts,
    promptUsed: prompt,
  };
}

async function applyQualityGate(args: {
  candidate: Omit<AiResult, "attempts" | "contextToolCalls" | "contextWindow">;
  attempts: AiAttempt[];
  inboundText: string;
  historyLines: string[];
  basePrompt: string;
  runtime?: RuntimeAiTuning;
  activePersonaPack: PersonaPack | null;
}) {
  const qualityMode: QualityGateMode = args.runtime?.qualityGateMode || "auto_rewrite_once";
  const threshold = clampQualityThreshold(
    args.runtime?.qualityGateThreshold,
    args.activePersonaPack?.checklist.passThreshold ?? 0.72,
  );
  const baseline = evaluateReplyQuality({
    replyText: args.candidate.text,
    inboundText: args.inboundText,
    historyLines: args.historyLines,
    pack: args.activePersonaPack,
    threshold,
  });

  let selected = args.candidate;
  let selectedEvaluation = baseline;
  let selectedAttempts = [...args.attempts];
  let qualityRewriteApplied = false;
  const manualReviewResult = (reason: string) =>
    ({
      text: "Manual review required.",
      provider: selected.provider,
      model: selected.model,
      latencyMs: selected.latencyMs,
      guardrailBlocked: true,
      guardrailReason: reason,
      qualityScore: selectedEvaluation.score,
      qualityChecks: selectedEvaluation.checks,
      qualityRewriteApplied,
      activePersonaPackId: args.activePersonaPack?.id,
      attempts: selectedAttempts,
    }) satisfies AiResult;

  if (!baseline.passed && qualityMode === "auto_rewrite_once") {
    const rewrite = await rewriteReplyOnce({
      candidateText: args.candidate.text,
      inboundText: args.inboundText,
      historyLines: args.historyLines,
      basePrompt: args.basePrompt,
      failedChecks: baseline.checks,
      runtime: args.runtime,
      pack: args.activePersonaPack,
    });
    selectedAttempts = [...selectedAttempts, ...rewrite.attempts];
    if (rewrite.result) {
      const rewrittenEvaluation = evaluateReplyQuality({
        replyText: rewrite.result.text,
        inboundText: args.inboundText,
        historyLines: args.historyLines,
        pack: args.activePersonaPack,
        threshold,
      });
      if (rewrittenEvaluation.score >= selectedEvaluation.score) {
        selected = rewrite.result;
        selectedEvaluation = rewrittenEvaluation;
        qualityRewriteApplied = normalizeOutboundText(args.candidate.text) !== normalizeOutboundText(rewrite.result.text);
      }
    }
  }

  const humorEvaluation = await evaluateHumorWithAi({
    candidateText: selected.text,
    inboundText: args.inboundText,
    historyLines: args.historyLines,
    runtime: args.runtime,
  });
  selectedAttempts = [...selectedAttempts, ...humorEvaluation.attempts];

  if (humorEvaluation.required && !humorEvaluation.judgment) {
    return manualReviewResult("Humor candidate detected but AI humor judge was unavailable.");
  }

  if (humorEvaluation.judgment?.isJokeAttempt && !humorEvaluation.judgment.isFunny) {
    return manualReviewResult(
      `AI humor judge marked draft as not funny (${Math.round(humorEvaluation.judgment.confidence * 100)}%): ${humorEvaluation.judgment.reason}`,
    );
  }

  if (humorEvaluation.judgment?.isJokeAttempt && humorEvaluation.judgment.isFunny) {
    const jokeGuardrail = evaluateJokeGuardrail(selected.text, args.historyLines);
    if (jokeGuardrail.blocked) {
      if (jokeGuardrail.code !== "recent_joke_chain") {
        return manualReviewResult(jokeGuardrail.reason);
      }

      const antiStretchRewrite = await rewriteJokeChainReplyOnce({
        candidateText: selected.text,
        inboundText: args.inboundText,
        historyLines: args.historyLines,
        basePrompt: args.basePrompt,
        runtime: args.runtime,
      });
      selectedAttempts = [...selectedAttempts, ...antiStretchRewrite.attempts];
      if (!antiStretchRewrite.result) {
        return manualReviewResult(`${jokeGuardrail.reason} Auto-rewrite failed.`);
      }

      selected = antiStretchRewrite.result;
      selectedEvaluation = evaluateReplyQuality({
        replyText: antiStretchRewrite.result.text,
        inboundText: args.inboundText,
        historyLines: args.historyLines,
        pack: args.activePersonaPack,
        threshold,
      });
      qualityRewriteApplied = qualityRewriteApplied || normalizeOutboundText(args.candidate.text) !== normalizeOutboundText(selected.text);

      const rewrittenHumorEvaluation = await evaluateHumorWithAi({
        candidateText: selected.text,
        inboundText: args.inboundText,
        historyLines: args.historyLines,
        runtime: args.runtime,
      });
      selectedAttempts = [...selectedAttempts, ...rewrittenHumorEvaluation.attempts];

      if (rewrittenHumorEvaluation.required && !rewrittenHumorEvaluation.judgment) {
        return manualReviewResult("Joke-chain rewrite produced a humor candidate but AI humor judge was unavailable.");
      }

      if (rewrittenHumorEvaluation.judgment?.isJokeAttempt && !rewrittenHumorEvaluation.judgment.isFunny) {
        return manualReviewResult(
          `Joke-chain rewrite was still humor but judged not funny (${Math.round(rewrittenHumorEvaluation.judgment.confidence * 100)}%): ${rewrittenHumorEvaluation.judgment.reason}`,
        );
      }

      if (rewrittenHumorEvaluation.judgment?.isJokeAttempt && rewrittenHumorEvaluation.judgment.isFunny) {
        const rewrittenGuardrail = evaluateJokeGuardrail(selected.text, args.historyLines);
        if (rewrittenGuardrail.blocked) {
          return manualReviewResult(`Joke-chain rewrite still violated guardrail: ${rewrittenGuardrail.reason}`);
        }
      }
    }
  }

  if (!selectedEvaluation.passed && qualityMode === "manual_review") {
    return manualReviewResult("Reply failed quality gate and manual review mode is enabled.");
  }

  return {
    ...selected,
    qualityScore: selectedEvaluation.score,
    qualityChecks: selectedEvaluation.checks,
    qualityRewriteApplied,
    activePersonaPackId: args.activePersonaPack?.id,
    attempts: selectedAttempts,
  } satisfies AiResult;
}

export async function generateReplyWithFallback(args: {
  inboundText: string;
  historyLines: string[];
  historySearchOverride?: HistorySearchOverride;
  styleHints: string[];
  styleProfile?: StyleProfileContext;
  personality?: PersonalityContext;
  grounding?: GroundingContext;
  runtime?: RuntimeAiTuning;
}): Promise<AiResult> {
  const activePersonaPack = resolveActivePersonaPack(args.runtime, args.personality);
  const finalizeResult = (result: AiResult): AiResult => {
    if (result.guardrailBlocked) {
      return result;
    }
    return {
      ...result,
      text: postProcessReplyText({
        text: result.text,
        inboundText: args.inboundText,
        historyLines: args.historyLines,
        theirName: args.grounding?.theirName,
        fallbackText: "All good.",
      }),
    };
  };
  const builtPrompt = buildPrompt(args);
  const blocked = HIGH_RISK_PATTERNS.find((pattern) => pattern.test(args.inboundText));
  if (blocked) {
    return {
      text: "Manual review required.",
      provider: "heuristic",
      model: "guardrail",
      latencyMs: 0,
      guardrailBlocked: true,
      guardrailReason: "High-risk topic detected in inbound message.",
      qualityScore: 1,
      qualityChecks: [],
      qualityRewriteApplied: false,
      activePersonaPackId: activePersonaPack?.id,
      contextToolCalls: builtPrompt.contextToolCalls,
      contextWindow: builtPrompt.contextWindow,
      attempts: [
        {
          provider: "heuristic",
          stage: "heuristic_guardrail",
          model: "guardrail",
          status: "success",
          latencyMs: 0,
        },
      ],
    };
  }

  const steeringMode = detectConversationSteeringMode({
    inboundText: args.inboundText,
    historyLines: args.historyLines,
  });
  const shouldUseHeuristicOnly =
    steeringMode === "hard_stop" || steeringMode === "pause" || steeringMode === "loop" || steeringMode === "wrap_up";
  if (shouldUseHeuristicOnly) {
    return finalizeResult({
      text: normalizeOutboundText(heuristicReply(args.inboundText, args.historyLines)),
      provider: "heuristic",
      model: `heuristic-local-${steeringMode}`,
      latencyMs: 0,
      guardrailBlocked: false,
      qualityScore: 1,
      qualityChecks: [],
      qualityRewriteApplied: false,
      activePersonaPackId: activePersonaPack?.id,
      contextToolCalls: builtPrompt.contextToolCalls,
      contextWindow: builtPrompt.contextWindow,
      attempts: [
        {
          provider: "heuristic",
          stage: "heuristic_fallback",
          model: `heuristic-local-${steeringMode}`,
          status: "success",
          latencyMs: 0,
        },
      ],
    });
  }

  const attempts: AiAttempt[] = [];
  const fallbackMode = resolveFallbackMode(args.runtime);

  const azureOutcome = await runWithBlockedRefusalReprompts({
    basePrompt: builtPrompt.prompt,
    inboundText: args.inboundText,
    run: (prompt) => runAzure(prompt, args.inboundText, args.historyLines, args.runtime),
  });
  attempts.push(...azureOutcome.attempts);
  if (azureOutcome.result) {
    const gated = await applyQualityGate({
      candidate: azureOutcome.result,
      attempts,
      inboundText: args.inboundText,
      historyLines: args.historyLines,
      basePrompt: azureOutcome.promptUsed,
      runtime: args.runtime,
      activePersonaPack,
    });
    return finalizeResult({
      ...gated,
      contextToolCalls: builtPrompt.contextToolCalls,
      contextWindow: builtPrompt.contextWindow,
    });
  }

  if (fallbackMode === "azure_only") {
    const lastAzureAttempt = attempts.filter((attempt) => attempt.provider === "azure").slice(-1)[0];
    return {
      text: "Manual review required.",
      provider: "azure",
      model: lastAzureAttempt?.model || "gpt-5.4",
      latencyMs: azureOutcome.attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0),
      guardrailBlocked: true,
      guardrailReason: "Azure-only mode enabled and Azure generation failed. Manual review required.",
      qualityScore: 1,
      qualityChecks: [],
      qualityRewriteApplied: false,
      activePersonaPackId: activePersonaPack?.id,
      attempts,
      contextToolCalls: builtPrompt.contextToolCalls,
      contextWindow: builtPrompt.contextWindow,
    };
  }

  const codexOutcome = await runWithBlockedRefusalReprompts({
    basePrompt: builtPrompt.prompt,
    inboundText: args.inboundText,
    run: (prompt) => runCodex(prompt, args.inboundText, args.historyLines, args.runtime),
  });
  attempts.push(...codexOutcome.attempts);
  if (codexOutcome.result) {
    const gated = await applyQualityGate({
      candidate: codexOutcome.result,
      attempts,
      inboundText: args.inboundText,
      historyLines: args.historyLines,
      basePrompt: codexOutcome.promptUsed,
      runtime: args.runtime,
      activePersonaPack,
    });
    return finalizeResult({
      ...gated,
      contextToolCalls: builtPrompt.contextToolCalls,
      contextWindow: builtPrompt.contextWindow,
    });
  }

  attempts.push({
    provider: "heuristic",
    stage: "heuristic_fallback",
    model: "heuristic-fallback",
    status: "success",
    latencyMs: 0,
  });
  const heuristicCandidate: Omit<AiResult, "attempts" | "contextToolCalls" | "contextWindow"> = {
    text: normalizeOutboundText(heuristicReply(args.inboundText, args.historyLines)),
    provider: "heuristic",
    model: "heuristic-fallback",
    latencyMs: 0,
    guardrailBlocked: false,
  };
  const gated = await applyQualityGate({
    candidate: heuristicCandidate,
    attempts,
    inboundText: args.inboundText,
    historyLines: args.historyLines,
    basePrompt: builtPrompt.prompt,
    runtime: args.runtime,
    activePersonaPack,
  });
  return finalizeResult({
    ...gated,
    contextToolCalls: builtPrompt.contextToolCalls,
    contextWindow: builtPrompt.contextWindow,
  });
}

export function estimateDelayAndTyping(text: string, runtime?: RuntimeAiTuning) {
  const len = Math.max(text.length, 10);
  const minDelay = Number(runtime?.delayMinMs ?? process.env.SLM_DELAY_MIN_MS ?? 12_000);
  const maxDelay = Number(runtime?.delayMaxMs ?? process.env.SLM_DELAY_MAX_MS ?? 65_000);
  const minTyping = Number(runtime?.typingMinMs ?? process.env.SLM_TYPING_MIN_MS ?? 2_500);
  const maxTyping = Number(runtime?.typingMaxMs ?? process.env.SLM_TYPING_MAX_MS ?? 9_000);

  const delayMs = Math.round(minDelay + (maxDelay - minDelay) * Math.min(len / 320, 1));
  const typingMs = Math.round(minTyping + (maxTyping - minTyping) * Math.min(len / 220, 1));

  return { delayMs, typingMs };
}
