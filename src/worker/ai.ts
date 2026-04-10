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
    | "ack_router_azure"
    | "ack_router_codex"
    | "heuristic_guardrail"
    | "heuristic_fallback"
    | "humor_judge_azure"
    | "humor_judge_codex";
  model: string;
  status: "success" | "error";
  latencyMs: number;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  usageSource?: "provider" | "estimated";
  estimatedCostUsd?: number;
  costCurrency?: "USD";
  pricingVersion?: string;
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
  toolCalls?: ContextToolCall[];
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
  learnedEmojiAllowlist?: string[];
  learnedEmojiCategoryHints?: string[];
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

type ContactMemoryFactType = "preference" | "profile" | "schedule" | "relationship" | "promise" | "other";

type ContactMemoryFactContext = {
  factValue: string;
  factType: ContactMemoryFactType;
  confidence?: number;
};

export type FriendshipGenerationCohort = "boomer" | "gen_z" | "bridge";

type FriendshipCohortInference = {
  cohort: FriendshipGenerationCohort;
  confidence: number;
  signals: string[];
  scenario?: string;
  usedBridgeFallback: boolean;
};

export type ProfessionalLinguaInference = {
  enabled: boolean;
  confidence: number;
  signals: string[];
  reason: "profile_professional" | "business_context" | "disabled";
};

type AzureApiStyle = "auto" | "chat_completions" | "responses";
type FallbackMode = "all" | "azure_only";
type AntiBeggiBeggiTone = "soft" | "firm" | "funny";
export type ConversationSteeringMode =
  | "none"
  | "hard_stop"
  | "pause"
  | "wrap_up"
  | "loop"
  | "anti_beggi_beggi"
  | "anti_sales_pitch"
  | "anti_puppet"
  | "anti_dry_joke";
export type AckRoutingChannel = "reaction_only" | "reaction_plus_text" | "text";
export type ContextToolName =
  | "context_window_detection"
  | "context_window_cleaning"
  | "conversation_history_search"
  | "contact_memory_fact_selection"
  | "response_workbench"
  | "model_tool_router_plan";

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

type ResponseReplyMode = "answer" | "confirm" | "clarify" | "close" | "lead";

type RuntimeAiTuning = {
  model?: string;
  apiStyle?: AzureApiStyle;
  fallbackMode?: FallbackMode;
  modelFirstEnabled?: boolean;
  deterministicModes?: string[];
  ackRoutingEnabled?: boolean;
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
  contextUtilizationTarget?: number;
  contextExpansionLineStep?: number;
  adaptiveContextMinTokens?: number;
  maxToolRounds?: number;
  maxToolCallsPerRound?: number;
  toolTimeoutMs?: number;
  codexTimeoutMs?: number;
  delayMinMs?: number;
  delayMaxMs?: number;
  typingMinMs?: number;
  typingMaxMs?: number;
};

type ToolRouterPlanInput = {
  task: string;
  candidateReply?: string;
  includeExtraction?: boolean;
  maxResults?: number;
  maxToolsPerRun?: number;
  threadId?: string;
  contactJid?: string;
};

type ModelToolExecutionResult = {
  status: "success" | "error" | "timeout";
  output?: unknown;
  errorCode?: string;
  errorMessage?: string;
  latencyMs: number;
};

export type ModelToolContext = {
  threadId?: string;
  contactJid?: string;
  executeToolRouterPlan: (args: {
    task: string;
    candidateReply?: string;
    includeExtraction: boolean;
    maxResults: number;
    maxToolsPerRun: number;
    toolTimeoutMs: number;
  }) => Promise<ModelToolExecutionResult>;
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

type JokeGuardrailCode = "none" | "cringe" | "similar_prior_joke" | "recent_joke_chain" | "unsupported_context";

type JokeGuardrailResult = {
  blocked: boolean;
  reason: string;
  code: JokeGuardrailCode;
};

type HumorEligibilityDecision = {
  allowHumor: boolean;
  playfulContext: boolean;
  riskContext: boolean;
  reasons: string[];
};

type CopyRiskResult = {
  blocked: boolean;
  reason: string;
  matchedSource?: string;
  lexicalSimilarity: number;
  longestTokenRun: number;
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
  /\b(?:allow|pardon)\s+me\s+small\b/i,
];
const SALES_INVENTORY_CLAIM_PATTERNS = [
  /\bi\s+(?:have|got|get)\s+(?:small\s+)?stock\b/i,
  /\bi(?:'|’)m\s+selling\b/i,
  /\bi\s+sell\b/i,
  /\bin\s+stock\b/i,
  /\bout\s+of\s+stock\b/i,
  /\bfor\s+sale\b/i,
  /\bavailable\s+for\s+orders?\b/i,
];
const AI_DISCLOSURE_PATTERNS = [
  /\bi\s+(?:have|use|run)\s+(?:an?\s+)?(?:ai|assistant|bot|automation)\b/i,
  /\b(?:my|an?|the)\s+(?:ai|assistant|bot|automation)\b.*\b(?:work(?:s|ing)?|help(?:s)?|handle(?:s)?|manag(?:e|es)|run(?:s)?)\b.*\b(?:for me|my)\b/i,
  /\b(?:work(?:s|ing)?\s+for\s+me)\b.*\b(?:ai|assistant|bot|automation)\b/i,
  /\bmy\s+(?:ai|assistant|bot|automation)\b/i,
  /\bi\s+use\s+(?:an?\s+)?(?:ai|assistant|bot|automation)\b/i,
];
const AI_DENIAL_PATTERNS = [
  /\bi\s+(?:do\s+not|don't|dont)\s+(?:use|have)\s+(?:an?\s+|any\s+)?(?:ai|assistant|bot|automation)\b/i,
  /\bi(?:'|’)m\s+not\s+using\s+(?:an?\s+)?(?:ai|assistant|bot|automation)\b/i,
  /\bno\s+(?:ai|assistant|bot|automation)\s+(?:here|involved)\b/i,
  /\b(?:just|only)\s+me\b/i,
  /\bi\s+reply\s+myself(?:\s+only)?\b/i,
  /\bmanual(?:ly)?\s+only\b/i,
];
const MATH_CUE_PATTERNS = [
  /\b(calculate|calc|solve|equation|evaluate|simplify|work out|find)\b/i,
  /\b(sum|difference|total|average|mean|remainder|plus|minus|times|multipl(?:y|ied)|divide|divided|percentage|percent)\b/i,
  /\b(add|subtract)\b/i,
  /\b(what do you get when|difference between|sum of)\b/i,
  /\b(squared|square root|cube|cubed)\b/i,
  /\bwhat(?:'|’)s\s+\d/i,
  /\bwhat\s+is\s+\d/i,
  /\bhow much is\b/i,
  /\bwork out\b/i,
];
const MATH_OPERATOR_EXPRESSION_PATTERN = /\b\d+(?:\.\d+)?\s*(?:[+\-*x×/])\s*\d+(?:\.\d+)?\b/i;
const MATH_LINEAR_EQUATION_PATTERN = /\b-?\d*\s*[a-z]\s*(?:[+\-]\s*\d+(?:\.\d+)?)?\s*=\s*-?\d+(?:\.\d+)?\b/i;
const MATH_DIRECT_ASK_PATTERN =
  /\b(what(?:'|’)s|what is|how much|find|solve|evaluate|work out|calculate|calc|what do you get when|difference between|sum of)\b/i;
const MATH_WORD_NUMBER_PATTERN =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b/i;
const CALCULATOR_STYLE_REPLY_PATTERNS = [
  /^=?\s*(?:the answer is\s*)?-?\d[\d,]*(?:\.\d+)?(?:\s*%| percent)?[.!?]?$/i,
  /^(?:it(?:'|’)s|it is|equals?)\s*-?\d[\d,]*(?:\.\d+)?(?:\s*%| percent)?[.!?]?$/i,
  /^(?:result|answer)\s*[:\-]\s*-?\d[\d,]*(?:\.\d+)?(?:\s*%| percent)?[.!?]?$/i,
  /^-?\d[\d,]*(?:\.\d+)?\s*(?:[+\-*/x×]\s*-?\d[\d,]*(?:\.\d+)?\s*)*=\s*-?\d[\d,]*(?:\.\d+)?[.!?]?$/i,
  /^[\d\s+\-*/x×=().,%]+$/,
];
const ANTI_CALCULATOR_MATH_OPENERS = [
  "I wasn't very good at math",
  "I'm no calculator",
  "Math is not my strongest suit",
  "My mental math is a little rusty",
  "I might be off here",
  "I'm doing this in my head",
  "I'm not in calculator mode",
  "I had to think through that one",
  "I am a bit rusty with numbers",
  "I can be wrong on quick math",
  "I'm estimating from memory",
  "I'm not a math machine",
  "I usually double-check numbers",
  "I had to do quick head math",
  "I might be overthinking this",
  "I'm working it out mentally",
  "I am trying to keep this human",
  "I could be slightly off",
  "I'm giving this a quick estimate",
  "I'm not perfect with arithmetic",
  "I might have done that too fast",
  "I had to rough-calc it",
  "I'm keeping it simple",
  "I'm taking a practical guess",
];
const ANTI_CALCULATOR_MATH_ENDINGS = [
  "but I think it's {{result}}.",
  "and I think it's {{result}}.",
  "so I think it's {{result}}.",
  "my best guess is {{result}}.",
  "I'd call it {{result}}.",
  "I'd say {{result}}.",
  "it should be {{result}}.",
  "I get {{result}}.",
  "I come out at {{result}}.",
  "I landed on {{result}}.",
  "I still think it's {{result}}.",
  "so I'd go with {{result}}.",
  "unless I slipped, it's {{result}}.",
  "if I did that right, it's {{result}}.",
  "from a quick check, it's {{result}}.",
  "my rough answer is {{result}}.",
  "I'd put it at {{result}}.",
  "that comes to {{result}}.",
  "it looks like {{result}} to me.",
  "I'd peg it at {{result}}.",
];
const MALE_GENDERED_TERMS = ["bro", "broski", "brother", "dude", "guy", "boy", "king", "sir", "mr", "handsome", "gentleman"];
const FEMALE_GENDERED_TERMS = ["sis", "sister", "girl", "queen", "maam", "madam", "mrs", "miss", "lady", "beautiful", "princess"];
const ROYAL_JOKE_TERMS = new Set(["king", "queen"]);
const BLOCKED_REFUSAL_PATTERNS = [/\bi(?:'|’)m sorry,\s*but\s*i cannot assist with that request\.?\b/i];
const BLOCKED_REFUSAL_ERROR = "Blocked refusal phrase detected.";
const BLOCKED_REFUSAL_REPROMPT_LIMIT = 2;
const MODEL_TOOL_ROUTER_NAME = "tool_router_plan";
const DEFAULT_MODEL_TOOL_MAX_ROUNDS = 3;
const DEFAULT_MODEL_TOOL_MAX_CALLS_PER_ROUND = 4;
const DEFAULT_MODEL_TOOL_TIMEOUT_MS = 8_000;
const MODEL_TOOL_MAX_ROUNDS_CAP = 8;
const MODEL_TOOL_MAX_CALLS_PER_ROUND_CAP = 8;
const MODEL_TOOL_TIMEOUT_MS_CAP = 30_000;
const MODEL_TOOL_MAX_RESULTS_CAP = 20;
const MODEL_TOOL_MAX_TOOLS_PER_RUN_CAP = 8;
const MODEL_TOOL_ROUTER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    task: {
      type: "string",
      minLength: 1,
      maxLength: 320,
    },
    candidateReply: {
      type: "string",
      maxLength: 600,
    },
    includeExtraction: {
      type: "boolean",
    },
    maxResults: {
      type: "integer",
      minimum: 1,
      maximum: MODEL_TOOL_MAX_RESULTS_CAP,
    },
    maxToolsPerRun: {
      type: "integer",
      minimum: 1,
      maximum: MODEL_TOOL_MAX_TOOLS_PER_RUN_CAP,
    },
  },
  required: ["task"],
} as const;
const AWKWARD_CATCHPHRASE_PATTERNS = [
  /\b(?:please|kindly|abeg)\s+(?:just\s+)?(?:allow|pardon)\s+me(?:\s+small)?\b/i,
  /\b(?:allow|pardon)\s+me\s+small\b/i,
];
const MIMICRY_INJECTION_PATTERNS = [
  /\b(word for word|verbatim|exact(?:ly)?|copy(?:\s+and\s+paste)?)\b/i,
  /\b(reply|respond|say|write)\b[\s\S]{0,60}\b(exact(?:ly)?|verbatim|word for word|copy)\b/i,
  /\b(pretend to be me|act as me|impersonat(?:e|ing)|sound exactly like me)\b/i,
  /\b(same typo|same punctuation|same spelling mistakes?)\b/i,
];
const STYLE_MIMICRY_BLOCK_PATTERNS = [
  /\b(?:https?:\/\/|www\.)\S+\b/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:\+?\d[\d\s-]{7,}\d)\b/,
  /\b(password|passcode|otp|pin|bank|account|routing|sort code|wire transfer|social security)\b/i,
  /\b(api key|access token|secret|auth token)\b/i,
];
const COPY_RISK_MIN_CHARS = 26;
const COPY_RISK_HIGH_SIMILARITY_THRESHOLD = 0.92;
const COPY_RISK_MEDIUM_SIMILARITY_THRESHOLD = 0.87;
const STYLE_MAX_PROMPT_PHRASE_WORDS = 6;
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
const CORE_HUMOR_PATTERN_GLOBAL = /\b(lol|lmao|lmfao|rofl|haha|hehe|funny|joke|banter|meme|roast|hilarious)\b/gi;
const CORE_HUMOR_EMOJI_PATTERN = /[😂🤣😹😆😄😁😅😜🤪🙃]/u;
const CORE_HUMOR_EMOJI_PATTERN_GLOBAL = /[😂🤣😹😆😄😁😅😜🤪🙃]/gu;
const LOW_SIGNAL_HUMOR_KEYWORDS = new Set(["status", "story", "update", "wild", "dead"]);
const HUMOR_SINGLE_TOKEN_ONLY_PATTERN = /^\s*(?:lol|lmao|lmfao|rofl|haha|hehe|😂|🤣|😹|😆|😄|😁|😅|😜|🤪|🙃)\s*[.!?]*\s*$/i;
const HUMOR_CONTEXT_BLOCK_PATTERNS = [
  /\b(death|died|funeral|burial|rip|hospital|surgery|diagnosis|cancer|emergency|accident|abuse|assault|suicid|depress(?:ed|ion)?)\b/i,
  /\b(password|otp|pin|social security|bank account|wire transfer|routing number|sort code|scam|fraud)\b/i,
  /\b(court|lawyer|legal|lawsuit|arrestd?|police report)\b/i,
  /\b(rent|salary|debt|loan|invoice overdue|payment issue)\b/i,
];
const HUMOR_CONTEXT_MIN_CHARS = 10;
const MAX_SAFE_MIMICRY_LEVEL = 0.82;
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
const MIMICRY_LOW_SIGNAL_TOKENS = new Set([
  "please",
  "kindly",
  "abeg",
  "allow",
  "pardon",
  "me",
  "small",
  "just",
  "okay",
  "ok",
  "alright",
  "noted",
  "got",
  "it",
  "understood",
  "thanks",
  "thank",
  "you",
  "let",
  "im",
  "my",
  "we",
  "our",
  "soon",
  "later",
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
  /\b(i dey drive(?:\s*(?:rn|now))?|i dey drivin(?:\s*(?:rn|now))?)\b/i,
  /\b(i dey waka now|i dey commute now)\b/i,
  /\b(outside rn|outside right now|on the road|in transit)\b/i,
  /\b(i(?:'|’)m|im|i am)\s+driv(?:ing|in)\b/i,
  /\bdriv(?:ing|in)\s+(?:rn|right now|now)\b/i,
  /\b(?:on|behind)\s+the\s+wheel\b/i,
  /\b(?:can(?:not|'t)|cant)\s+(?:text|chat|talk)\s+(?:while|when)\s+driv(?:ing|in)\b/i,
  /\b(i('|’)m busy|in a meeting|driving right now|about to sleep|heading out)\b/i,
];
const MONEY_REQUEST_PATTERNS = [
  /\b(?:abeg|please|pls)\b[\s,]*(?:you\s+)?(?:fit|go\s+fit|can|could)?[\s,]*(?:send|borrow|lend|loan|dash|transfer|help|assist)\b.*\b(?:me|my)\b.*\b(?:\d+(?:\.\d+)?\s*[km]?|money|cash|naira|funds?|airtime|transport|fare)\b/i,
  /\b(?:can|could|fit)\s+you\b.*\b(?:send|borrow|lend|loan|dash|transfer|help|assist)\b.*\b(?:me|my)\b.*\b(?:\d+(?:\.\d+)?\s*[km]?|money|cash|naira|funds?|airtime|transport|fare)\b/i,
  /\b(?:send|borrow|lend|loan|dash|transfer)\s+me\s+(?:like\s+|just\s+|small\s+)?(?:\d+(?:\.\d+)?\s*[km]?|money|cash|naira|funds?|airtime)\b/i,
  /\bhelp\s+me\b.*\b(?:with|for)\b.*\b(?:\d+(?:\.\d+)?\s*[km]?|money|cash|naira|funds?|airtime|transport|fare)\b/i,
];
const SALES_PITCH_STRONG_PATTERN =
  /\b(link in bio|order now|buy now|book now|promo code|use code|limited offer|while stocks? last|for sale|available for (booking|bookings|order|orders|sale))\b/i;
const SALES_PITCH_INTENT_PATTERN =
  /\b(sale|discount|promo|promotion|offer|deal|clearance|pre[- ]?order|order|orders|buy|selling|sell|book|booking|bookings|price|pricing|rates?|slot|slots|available|delivery)\b/i;
const SALES_PITCH_CTA_PATTERN = /\b(dm|dms|inbox|message|whatsapp|call|text|tap|click|contact|pay|payment|deposit)\b/i;
const SALES_PITCH_PRICE_PATTERN = /(?:[$£€₦]|usd|ngn|naira)\s?\d|\b\d{2,}\s?(?:usd|ngn|naira|bucks|k)\b/i;
const SALES_PITCH_DISCOUNT_PATTERN = /\b\d{1,3}\s?%\s?off\b/i;
const SALES_PITCH_PATRONIZE_PATTERN = /\b(patroni[sz]e|place an? order|interested\??|available now)\b/i;
const PUPPET_JOKE_REQUEST_PATTERNS = [
  /\b(?:tell|give|say|drop|share|crack)\s+(?:me\s+)?(?:a\s+|one\s+|some\s+)?(?:joke|jokes|pun|something funny)\b/i,
  /\bmake\s+me\s+laugh\b/i,
  /\b(?:be|sound)\s+funny\b/i,
  /\bentertain\s+me\b/i,
  /\bjokes?\s+please\b/i,
  /\bdo\s+(?:a\s+)?joke\b/i,
];
const PUPPET_BOT_FRAMING_PATTERN = /\b(chatgpt|ai\s*bot|bot|assistant)\b/i;
const PUPPET_HUMOR_KEYWORD_PATTERN = /\b(joke|jokes|funny|laugh|banter|pun)\b/i;
const PUPPET_TOPIC_STOPWORDS = new Set([
  "tell",
  "give",
  "say",
  "drop",
  "share",
  "crack",
  "joke",
  "jokes",
  "pun",
  "funny",
  "laugh",
  "entertain",
  "chatgpt",
  "assistant",
  "bot",
  "make",
  "about",
  "please",
  "pls",
  "like",
  "something",
]);
const ANTI_PUPPET_EN_VARIANTS = [
  "Comedy mode is off-duty, but I can still keep it real on {{topic}}.",
  "No chatbot stand-up today, but I can still talk straight about {{topic}}.",
  "I parked the joke script, so let's just handle {{topic}} like normal humans.",
  "My inner comedian is on break, but I'm still here for {{topic}}.",
  "No punchline package from me right now, just a real response on {{topic}}.",
];
const ANTI_PUPPET_PIDGIN_VARIANTS = [
  "No be comedy show today, but we fit handle {{topic}} like normal people.",
  "Joke mode don sleep, make we just keep am real for {{topic}}.",
  "No bot cruise for now, but I still dey here for {{topic}}.",
  "My comedian side dey on break, make we reason {{topic}} straight.",
  "No punchline package today, make we just sort {{topic}} normal.",
];
const DRY_JOKE_CALL_OUT_EN_VARIANTS = [
  "That joke was so dry it came with a humidity warning.",
  "Dry humor level: Sahara deluxe, but I respect your confidence.",
  "That punchline arrived with desert vibes and no water break.",
  "That joke was bone-dry, but the commitment was elite.",
];
const DRY_JOKE_SOFT_EN_VARIANTS = [
  "That one dry small, but keep going, you go land one soon.",
  "Joke dry tiny, but I see the vision, run another one.",
];
const DRY_JOKE_CALL_OUT_PIDGIN_VARIANTS = [
  "That joke dry pass harmattan, but your confidence strong.",
  "Dry humor full ground here, e still funny for spirit sha.",
  "That punchline dry like Sunday sun, but I respect the effort.",
  "That joke dry die, but the vibes still dey.",
];
const DRY_JOKE_SOFT_PIDGIN_VARIANTS = [
  "That one dry small, but drop another one make we check am.",
  "Joke dry tiny, but I see wetin you try do, run am again.",
];
const DRY_JOKE_TEMPLATE_PATTERNS = [
  /\bknock knock\b/i,
  /\bwhy did the\b/i,
  /\bdad joke\b/i,
  /\bpun intended\b/i,
  /\b(?:two|three)\s+[\w'-]+(?:\s+[\w'-]+){0,5}\s+walked into (?:a|the)\s+bar\b/i,
  /\bhow many\s+[\w\s'-]{1,40}\s+does it take to change a light bulb\b/i,
  /\broses are red\b[\s\S]{0,90}\bviolets are blue\b/i,
];
const DRY_JOKE_SETUP_PATTERNS = [
  /\bwhat do you call\b[\s\S]{0,120}(?:\?|$)/i,
  /\b(?:here(?:'|’)s|here is|i have|got)\s+(?:a\s+)?(?:corny\s+|dry\s+|dad\s+)?(?:joke|pun)\b/i,
  /\b(?:let me|lemme)\s+(?:drop|tell)\s+(?:you\s+)?(?:a\s+)?(?:joke|pun)\b/i,
];
const DRY_JOKE_PUNCHLINE_PATTERNS = [
  /\?\s*(?:because|cos|cuz|cause)\b/i,
  /\b(?:ba[\s-]?dum[\s-]?tss|rimshot|get it\??)\b/i,
  /\b(?:that(?:'|’)s|thats)\s+the\s+joke\b/i,
  /\bno\s+pun\s+intended\b/i,
];
const DRY_JOKE_META_PATTERNS = [
  /\b(?:corny|cheesy|lame)\s+(?:joke|humou?r)\b/i,
  /\b(?:one[-\s]?liner|punchline|dry\s+humou?r)\b/i,
];
const DRY_JOKE_RETROSPECTIVE_PATTERNS = [
  /\bthat joke you told\b/i,
  /\b(?:remember|about)\s+(?:that|the|your)\s+joke\b/i,
  /\b(?:your|that|the)\s+joke\b[\s\S]{0,50}\b(?:yesterday|last\s+(?:night|time|week)|earlier|before)\b/i,
];
const ANTI_BEGGI_BEGGI_PIDGIN_VARIANTS: Record<AntiBeggiBeggiTone, string[]> = {
  soft: [
    "Omohhh, things no really good here mehn. Money tight, I no fit send now.",
    "Omoh, e no easy for my side right now. Money tight, I no fit help with cash now.",
    "Omo, things tight for my end mehn. Money tight, I no fit do transfer now.",
    "Omoh, money tight die for my side now. I no fit send you cash this period.",
    "I for like help you, but things no soft for here now. Money tight, I no fit assist financially now.",
  ],
  firm: [
    "Abeg understand, I cannot help financially now. Money tight, I no fit send you anything.",
    "No vex, I cannot assist financially at the moment. Money tight for my side.",
    "I cannot transfer money now, abeg. Things tight and I no fit run am.",
    "I cannot borrow you now, abeg. Money tight and I need hold my expenses.",
    "Please no pressure me on this one, I cannot assist financially now.",
  ],
  funny: [
    "Small cruise aside, account don lock up. Money tight, I no fit send now.",
    "Small cruise aside, my wallet dey do hide and seek. Money tight, I no fit transfer now.",
    "Small cruise aside, na survival mode I dey. Money tight, I no fit lend now.",
    "Small cruise aside, budget don humble me. Money tight, I no fit send cash now.",
    "Small cruise aside, my bank app and I dey quarrel. Money tight, I no fit help now.",
  ],
};
const ANTI_BEGGI_BEGGI_EN_VARIANTS: Record<AntiBeggiBeggiTone, string[]> = {
  soft: [
    "Omoh, things are really tight on my side right now. Money is tight, so I cannot send anything now.",
    "Things are tight for me at the moment and money is really stretched, so I cannot help financially right now.",
    "I am not in a good place financially right now. Money is tight, so I cannot send anything at the moment.",
    "I wish I could help, but money is very tight for me right now, so I cannot send anything.",
    "I am currently stretched with bills, and money is tight, so I cannot assist financially now.",
  ],
  firm: [
    "I cannot assist financially right now. Money is tight on my side.",
    "I cannot transfer money at the moment. Money is tight for me right now.",
    "I cannot lend or borrow out money now. Things are tight on my end.",
    "I cannot help with cash right now. My finances are tight at the moment.",
    "Please understand, I cannot assist financially now because money is tight.",
  ],
  funny: [
    "Small joke aside, my account is on red alert. Money is tight, so I cannot send anything now.",
    "Small joke aside, my wallet is on strike. Money is tight, so I cannot transfer now.",
    "Small joke aside, my budget has humbled me. Money is tight, so I cannot lend now.",
    "Small joke aside, my bank app is giving me attitude. Money is tight, so I cannot help with cash now.",
    "Small joke aside, this month is wrestling me. Money is tight, so I cannot assist financially now.",
  ],
};
const WRAP_UP_PATTERNS = [
  /^(ok|okay|cool|great|nice|perfect|all good|all gud|sounds good|done|resolved|all set|we good|we gud|bet+|say less+|k{1,4}|o+k+|works|copy|solid|valid|for sure|fs|fasho|word|heard|copy that|copy dat|sharp sharp|na so|ehen)[.!]*$/i,
  /^(thanks|thank you|thx|ty|tnx|thnks|tysm|that helps|got it|noted|understood|appreciate it|appreciate you)[.!]*$/i,
  /^(safe|safee|we move|we mov|no wahala|nwahala|sharp|copy o|na true|alright na|alrighty|alryt|all good sha|we good abeg|noted boss|thanks o|thank you o+|thx abeg|na so|ehen|sharp sharp)[.!]*$/i,
  /^(thanks|thank you|thx|ty|appreciate it|appreciate you)\s*,\s*(all good|we good|sounds good|got it|that helps|done|resolved|all set)[.!]*$/i,
  /^(bet+|say less+|kk|k|works|copy|solid|valid|all set|we good|for sure|fs|fasho|word|heard|copy that)[.!]*$/i,
];
const AGGRESSIVE_INSULT_PATTERNS = [
  /\b(fuck you|f\*+\s*you|go to hell|shut up|idiot|stupid|moron|loser|useless|trash|piece of shit|nonsense)\b/i,
  /\b(you(?:'re| are)\s+(?:so\s+)?(?:an?\s+)?(idiot|stupid|dumb|moron|useless|trash|mad|crazy))\b/i,
  /\b(dumbass|jackass|asshole)\b/i,
  /\b(mumu|werey|olodo|thunder fire you)\b/i,
  /\bwtf\b/i,
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
const OLD_ENGLISH_CORE_TOKENS_PATTERN =
  /\b(thou|thee|thy|thine|hath|doth|dost|hast|shalt|wilt|wherefore|whence|hither|forsooth|verily|beseech|mayhap|methinks|canst)\b/i;
const OLD_ENGLISH_LIGHT_TOKENS_PATTERN = /\b(aye|nay|anon|tis|'tis)\b/i;
const OLD_ENGLISH_CORE_TOKENS_PATTERN_GLOBAL =
  /\b(thou|thee|thy|thine|hath|doth|dost|hast|shalt|wilt|wherefore|whence|hither|forsooth|verily|beseech|mayhap|methinks|canst)\b/gi;
const OLD_ENGLISH_LIGHT_TOKENS_PATTERN_GLOBAL = /\b(aye|nay|anon|tis|'tis)\b/gi;
const OLD_ENGLISH_PHRASE_PATTERN = /\b(good morrow|pray tell|i beseech(?: thee)?|if it please thee|thou art)\b/i;
const OLD_ENGLISH_VERB_ENDING_PATTERN = /\b[a-z]{3,}eth\b/i;
const OLD_ENGLISH_MIRRORABLE_REPLY_PREFIX_PATTERN =
  /^(understood|got it|all good|no worries|sure|okay|ok|yes|yeah|yep|thanks|thank you|i can|i will|i'll|we can|let's|no problem)\b/i;
const ACK_ONLY_PATTERNS = [
  /^(ok|okay|sure|cool|great|perfect|nice|done|noted|got it|understood|alright|aight|ight|alrighty|alryt|k{1,4}|o+k+|bet+|say less+|works|copy|copy dat|solid|valid|all set|we good|we gud|for sure|fs|sounds good|all good|all gud|fasho|word|heard|copy that|na so|ehen|sharp sharp)[.!]*$/i,
  /^(thanks|thank you|thx|ty|tnx|thnks|tysm|appreciate it|appreciate you)[.!]*$/i,
  /^(safe|safee|we move|we mov|no wahala|nwahala|sharp|copy o|na true|alright na|all good sha|we good abeg|noted boss|thanks o|thank you o+|thx abeg|na so|ehen|sharp sharp)[.!]*$/i,
  /^(thanks|thank you|thx|ty|appreciate it|appreciate you|preciate you)(?:\s+\w{2,12})?[.!]*$/i,
  /^(thanks|thank you|thx|ty|appreciate it|appreciate you)\s*,\s*(all good|we good|sounds good|got it|that helps|done|resolved|all set)[.!]*$/i,
];
const LEAD_HANDOFF_PATTERNS = [
  /\b(up to you|you decide|your call|you choose|pick for me|surprise me)\b/i,
  /\b(anything works|whatever works|either one works|any option is fine)\b/i,
  /\b(i (?:do(?:n't|nt) know|dont know)|not sure|no preference)\b/i,
];
const LOW_MOMENTUM_PATTERNS = [
  /^(hmm+|hmmm+|idk|i don't know|i dont know|not sure|whatever|anything|either one|you choose|up to you)[.!]*$/i,
];
const CLOSE_MODE_REOPEN_PATTERNS = [
  /\b(let me know|keep me posted)\b/i,
  /\b(what do you think|how does that sound|does that work|is that okay)\b/i,
  /\b(anything else|any other thing|any thoughts?)\b/i,
  /\b(feel free to .*reach out|reach out if you need)\b/i,
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

function countCoreHumorKeywordHits(text: string) {
  return text.match(CORE_HUMOR_PATTERN_GLOBAL)?.length ?? 0;
}

function countCoreHumorEmojiHits(text: string) {
  return text.match(CORE_HUMOR_EMOJI_PATTERN_GLOBAL)?.length ?? 0;
}

function hasHumorContextBlock(text: string) {
  return HUMOR_CONTEXT_BLOCK_PATTERNS.some((pattern) => pattern.test(text));
}

function hasHumorSignal(text: string, keywords: string[], emojis: string[]) {
  const normalized = normalizeOutboundText(text || "");
  if (normalized.length < HUMOR_CONTEXT_MIN_CHARS) {
    return false;
  }
  if (HUMOR_SINGLE_TOKEN_ONLY_PATTERN.test(normalized)) {
    return false;
  }
  if (hasHumorContextBlock(normalized)) {
    return false;
  }

  const coreKeywordHits = countCoreHumorKeywordHits(normalized);
  const coreEmojiHits = countCoreHumorEmojiHits(normalized);
  const configuredKeywordHits = countConfiguredHumorKeywordHits(normalized, keywords);
  const configuredEmojiHit = hasConfiguredHumorEmojiHit(normalized, emojis);
  const hasPlayfulCue = /\b(joke|banter|roast|meme|tease|playful|hilarious|comic|funny)\b/i.test(normalized);

  if (coreKeywordHits >= 2 || configuredKeywordHits >= 2) {
    return true;
  }
  if ((coreEmojiHits >= 1 || configuredEmojiHit) && (coreKeywordHits >= 1 || configuredKeywordHits >= 1 || hasPlayfulCue)) {
    return true;
  }
  if ((coreKeywordHits >= 1 || configuredKeywordHits >= 1) && hasPlayfulCue) {
    return true;
  }
  if ((coreKeywordHits >= 1 || configuredKeywordHits >= 1) && normalized.length >= 28 && !/\b(status|story)\b/i.test(normalized)) {
    return true;
  }
  return false;
}

function hasMimicryInjectionCue(args: { inboundText: string; historyLines: string[] }) {
  const inbound = normalizeOutboundText(args.inboundText || "");
  const recentInbound = args.historyLines
    .slice(-6)
    .map((line) => parseHistoryLine(line))
    .filter((line) => line.label === "Them")
    .map((line) => line.body)
    .join(" ");
  const sample = normalizeOutboundText([inbound, recentInbound].filter(Boolean).join(" "));
  if (!sample) {
    return false;
  }
  return MIMICRY_INJECTION_PATTERNS.some((pattern) => pattern.test(sample));
}

function evaluateHumorEligibility(args: {
  inboundText: string;
  historyLines: string[];
  steeringMode: ConversationSteeringMode;
  soulModeEnabled: boolean;
  funnyKeywords: string[];
  funnyEmojis: string[];
}) {
  if (!args.soulModeEnabled) {
    return {
      allowHumor: false,
      playfulContext: false,
      riskContext: true,
      reasons: ["soul_mode_disabled"],
    } satisfies HumorEligibilityDecision;
  }

  const inbound = normalizeOutboundText(args.inboundText || "");
  const recentInboundSample = args.historyLines
    .slice(-10)
    .map((line) => parseHistoryLine(line))
    .filter((line) => line.label === "Them")
    .map((line) => line.body)
    .join(" ");
  const contextSample = [inbound, recentInboundSample].filter(Boolean).join(" ");
  const playfulContext =
    hasHumorSignal(inbound, args.funnyKeywords, args.funnyEmojis) ||
    (Boolean(recentInboundSample) && hasHumorSignal(recentInboundSample, args.funnyKeywords, args.funnyEmojis));

  const reasons: string[] = [];
  if (!playfulContext) {
    reasons.push("no_strong_playful_context");
  }
  if (contextSample && hasHumorContextBlock(contextSample)) {
    reasons.push("sensitive_context");
  }
  if (HIGH_RISK_PATTERNS.some((pattern) => pattern.test(contextSample))) {
    reasons.push("high_risk_pattern");
  }
  if (hasMoneyRequestCue(inbound)) {
    reasons.push("money_request");
  }
  if (hasSalesPitchCue(inbound)) {
    reasons.push("sales_pitch");
  }
  if (hasAggressiveInsultCue(inbound)) {
    reasons.push("aggressive_tone");
  }
  if (args.steeringMode !== "none") {
    reasons.push(`steering_${args.steeringMode}`);
  }
  if (hasRecentOutboundJokeInCooldown(args.historyLines, JOKE_CHAIN_OUTBOUND_COOLDOWN)) {
    reasons.push("recent_joke_chain");
  }

  const riskReasons = reasons.filter((reason) => reason !== "no_strong_playful_context");
  return {
    allowHumor: playfulContext && riskReasons.length === 0,
    playfulContext,
    riskContext: riskReasons.length > 0,
    reasons,
  } satisfies HumorEligibilityDecision;
}

function buildHumorEligibilityRewriteInstruction(decision: HumorEligibilityDecision) {
  const riskReasons = decision.reasons.filter((reason) => reason !== "no_strong_playful_context");
  if (riskReasons.length > 0) {
    return `Humor is disallowed for this message due to risk context (${riskReasons.join(", ")}). Rewrite into a direct, non-joke reply.`;
  }
  return "Humor is disallowed because playful context is weak. Rewrite into a direct, non-joke reply.";
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

function hasMoneyRequestCue(text: string) {
  const normalized = normalizeOutboundText(text || "");
  if (!normalized) {
    return false;
  }
  return MONEY_REQUEST_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasSalesPitchCue(text: string) {
  const normalized = normalizeOutboundText(text || "");
  if (!normalized) {
    return false;
  }

  if (SALES_PITCH_STRONG_PATTERN.test(normalized)) {
    return true;
  }

  const hasIntent = SALES_PITCH_INTENT_PATTERN.test(normalized);
  const hasCta = SALES_PITCH_CTA_PATTERN.test(normalized);
  const hasPrice = SALES_PITCH_PRICE_PATTERN.test(normalized) || SALES_PITCH_DISCOUNT_PATTERN.test(normalized);
  const hasPatronize = SALES_PITCH_PATRONIZE_PATTERN.test(normalized);
  return (hasIntent && hasCta) || (hasIntent && hasPrice) || (hasIntent && hasPatronize);
}

function hasPuppetJokeRequestCue(text: string) {
  const normalized = normalizeOutboundText(text || "");
  if (!normalized) {
    return false;
  }
  if (PUPPET_JOKE_REQUEST_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  if (PUPPET_BOT_FRAMING_PATTERN.test(normalized) && PUPPET_HUMOR_KEYWORD_PATTERN.test(normalized)) {
    return true;
  }
  return false;
}

function extractPuppetTopicHint(text: string) {
  const normalized = normalizeOutboundText(text || "").toLowerCase();
  if (!normalized) {
    return "";
  }
  const tokens = normalized
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2)
    .filter((token) => !STOPWORDS.has(token))
    .filter((token) => !PUPPET_TOPIC_STOPWORDS.has(token));
  return tokens.slice(0, 3).join(" ");
}

function buildAntiPuppetReply(input: string, pidginMode: boolean) {
  const topicHint = extractPuppetTopicHint(input);
  const topic = topicHint || (pidginMode ? "this gist" : "this");
  const options = pidginMode ? ANTI_PUPPET_PIDGIN_VARIANTS : ANTI_PUPPET_EN_VARIANTS;
  const template = pickVariant(`${input}:anti_puppet:${topic}:${pidginMode ? "pidgin" : "en"}`, options);
  return normalizeOutboundText(template.replaceAll("{{topic}}", topic));
}

function countPatternHits(text: string, patterns: RegExp[]) {
  return patterns.reduce((hits, pattern) => (pattern.test(text) ? hits + 1 : hits), 0);
}

function hasDryJokeAttemptCue(text: string) {
  const normalized = normalizeOutboundText(text || "");
  if (!normalized) {
    return false;
  }
  if (hasPuppetJokeRequestCue(normalized)) {
    return false;
  }
  if (DRY_JOKE_RETROSPECTIVE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  const templateHits = countPatternHits(normalized, DRY_JOKE_TEMPLATE_PATTERNS);
  const setupHits = countPatternHits(normalized, DRY_JOKE_SETUP_PATTERNS);
  const punchlineHits = countPatternHits(normalized, DRY_JOKE_PUNCHLINE_PATTERNS);
  const metaHits = countPatternHits(normalized, DRY_JOKE_META_PATTERNS);

  let score = 0;
  if (templateHits > 0) {
    score += 2;
  }
  if (setupHits > 0) {
    score += 1;
  }
  if (punchlineHits > 0) {
    score += 1;
  }
  if (metaHits > 0) {
    score += 1;
  }
  if (setupHits > 0 && /\?\s*[a-z0-9'"-]{1,20}(?:\s+[a-z0-9'"-]{1,20}){0,5}[.!]*$/i.test(normalized)) {
    score += 1;
  }
  if (
    /\bwhat do you call\b[\s\S]{0,120}\s[-:]\s*[a-z0-9'"-]{1,20}(?:\s+[a-z0-9'"-]{1,20}){0,5}[.!]*$/i.test(
      normalized,
    )
  ) {
    score += 1;
  }

  return score >= 2;
}

function buildDryJokeReply(input: string, pidginMode: boolean) {
  const mode = pickVariant(`${input}:anti_dry_joke:mode`, ["callout", "callout", "soft"]);
  const options =
    mode === "callout"
      ? pidginMode
        ? DRY_JOKE_CALL_OUT_PIDGIN_VARIANTS
        : DRY_JOKE_CALL_OUT_EN_VARIANTS
      : pidginMode
        ? DRY_JOKE_SOFT_PIDGIN_VARIANTS
        : DRY_JOKE_SOFT_EN_VARIANTS;
  return normalizeOutboundText(pickVariant(`${input}:anti_dry_joke:${mode}:${pidginMode ? "pidgin" : "en"}`, options));
}

function detectAntiBeggiBeggiToneFromInbound(input: string): AntiBeggiBeggiTone {
  const normalized = normalizeOutboundText(input || "");
  if (!normalized) {
    return "soft";
  }

  if (/\b(lol|lmao|haha|hehe|joke|banter)\b/i.test(normalized) || /[😂🤣😅😆]/u.test(normalized)) {
    return "funny";
  }

  if (/\b(again|still|urgent|asap|now now|today|immediately|pls pls|please please)\b/i.test(normalized)) {
    return "firm";
  }

  return "soft";
}

function resolveAntiBeggiBeggiTone(input: string): AntiBeggiBeggiTone {
  return detectAntiBeggiBeggiToneFromInbound(input);
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

  if (hasMoneyRequestCue(inbound)) {
    return "anti_beggi_beggi";
  }

  if (hasSalesPitchCue(inbound)) {
    return "anti_sales_pitch";
  }

  if (hasPuppetJokeRequestCue(inbound)) {
    return "anti_puppet";
  }

  if (hasDryJokeAttemptCue(inbound)) {
    return "anti_dry_joke";
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

export function hasAggressiveInsultCue(text: string) {
  const normalized = normalizeOutboundText(text || "");
  if (!normalized) {
    return false;
  }
  return AGGRESSIVE_INSULT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function scoreOldEnglishSample(sample: string) {
  const normalized = normalizeOutboundText(sample).toLowerCase();
  if (!normalized) {
    return 0;
  }

  const coreHits = normalized.match(OLD_ENGLISH_CORE_TOKENS_PATTERN_GLOBAL)?.length ?? 0;
  const lightHits = normalized.match(OLD_ENGLISH_LIGHT_TOKENS_PATTERN_GLOBAL)?.length ?? 0;
  const phraseBoost = OLD_ENGLISH_PHRASE_PATTERN.test(normalized) ? 0.9 : 0;
  const verbEndingBoost = OLD_ENGLISH_VERB_ENDING_PATTERN.test(normalized) ? 0.45 : 0;
  const score = Math.min(coreHits, 3) * 0.75 + Math.min(lightHits, 2) * 0.35 + phraseBoost + verbEndingBoost;
  return Number(score.toFixed(3));
}

export function detectOldEnglishSignal(args: { inboundText: string; historyLines: string[] }) {
  const inbound = normalizeOutboundText(args.inboundText || "");
  const historySample = normalizeOutboundText(
    (args.historyLines || [])
      .slice(-8)
      .map((line) => line.replace(/^(Me|Them):\s*/i, ""))
      .join(" "),
  );
  const inboundScore = scoreOldEnglishSample(inbound);
  const historyScore = historySample ? scoreOldEnglishSample(historySample) : 0;
  if (inboundScore >= 1.05) {
    return true;
  }
  if (historyScore >= 1.2) {
    return true;
  }
  return inboundScore + historyScore * 0.35 >= 1.05;
}

function buildOldEnglishReplyInstruction(oldEnglishMode: boolean) {
  if (oldEnglishMode) {
    return "Old-English tone is active in this chat. Mirror lightly with at most one archaic touch (for example: 'aye', 'thou', or 'shall') while keeping the message clear and modern-readable. Do not overdo it or roleplay unless asked.";
  }
  return "Use modern conversational English unless the contact clearly uses old-English phrasing.";
}

function applyOldEnglishMirror(text: string, enabled: boolean) {
  const normalized = normalizeOutboundText(text || "");
  if (!enabled || !normalized) {
    return normalized;
  }

  if (
    OLD_ENGLISH_CORE_TOKENS_PATTERN.test(normalized) ||
    OLD_ENGLISH_LIGHT_TOKENS_PATTERN.test(normalized) ||
    normalized.length > 160 ||
    !OLD_ENGLISH_MIRRORABLE_REPLY_PREFIX_PATTERN.test(normalized)
  ) {
    return normalized;
  }

  return normalizeOutboundText(`Aye, ${normalized}`);
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
  if (mode === "anti_beggi_beggi") {
    return "The latest message is asking you for money/transfer support. Decline politely in one short line, explain that money is tight, and do not over-explain or ask follow-up questions.";
  }
  if (mode === "anti_sales_pitch") {
    return "The latest message appears to be a sales pitch or negotiation attempt. Send one short close-out line like you'll take a look/check, and do not negotiate, ask follow-up questions, or continue the sales thread.";
  }
  if (mode === "anti_puppet") {
    return "The latest message is framing you like a chatbot entertainer (for example asking for a joke on command). Send one short, playful-but-not-joke human line that keeps things real and does not deliver a punchline.";
  }
  if (mode === "anti_dry_joke") {
    return "The latest message is a clearly dry/corny joke attempt. Respond with one short silly call-out line (playful, not hostile) and avoid long explanations or follow-up questions.";
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
  return "No hard close-out steering mode is active. Stay direct, context-specific, and momentum-focused without drifting into generic filler.";
}

function shouldForceNoFollowUpQuestion(mode: ConversationSteeringMode) {
  return (
    mode === "hard_stop" ||
    mode === "anti_beggi_beggi" ||
    mode === "anti_sales_pitch" ||
    mode === "anti_puppet" ||
    mode === "anti_dry_joke" ||
    mode === "pause" ||
    mode === "loop" ||
    mode === "wrap_up"
  );
}

const LEGACY_HEURISTIC_ONLY_STEERING_MODES: ConversationSteeringMode[] = [
  "hard_stop",
  "anti_beggi_beggi",
  "anti_sales_pitch",
  "anti_puppet",
  "anti_dry_joke",
  "pause",
  "loop",
  "wrap_up",
];

const DEFAULT_MODEL_FIRST_DETERMINISTIC_MODES: ConversationSteeringMode[] = [
  "hard_stop",
  "anti_beggi_beggi",
  "anti_sales_pitch",
  "anti_puppet",
  "anti_dry_joke",
];

const ALLOWED_DETERMINISTIC_STEERING_MODE_SET = new Set<ConversationSteeringMode>(LEGACY_HEURISTIC_ONLY_STEERING_MODES);

function resolveDeterministicBypassModes(runtime?: RuntimeAiTuning) {
  if (!runtime?.modelFirstEnabled) {
    return new Set(LEGACY_HEURISTIC_ONLY_STEERING_MODES);
  }
  const requested = (runtime.deterministicModes || [])
    .map((mode) => mode.trim().toLowerCase())
    .filter(
      (mode): mode is ConversationSteeringMode =>
        mode !== "none" && ALLOWED_DETERMINISTIC_STEERING_MODE_SET.has(mode as ConversationSteeringMode),
    );
  if (requested.length === 0) {
    return new Set(DEFAULT_MODEL_FIRST_DETERMINISTIC_MODES);
  }
  return new Set(requested);
}

function hasLeadHandoffCue(text: string) {
  const normalized = normalizeOutboundText(text || "");
  if (!normalized) {
    return false;
  }
  if (LEAD_HANDOFF_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  return LOW_MOMENTUM_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasCloseModeReopenCue(text: string) {
  const normalized = normalizeOutboundText(text || "");
  if (!normalized) {
    return false;
  }
  return CLOSE_MODE_REOPEN_PATTERNS.some((pattern) => pattern.test(normalized));
}

function heuristicReply(input: string, historyLines: string[] = []) {
  const steeringMode = detectConversationSteeringMode({
    inboundText: input,
    historyLines,
  });
  const pidginMode = detectPidginSignal({ inboundText: input, historyLines });
  const allowBossEscalation =
    steeringMode !== "hard_stop" &&
    steeringMode !== "anti_beggi_beggi" &&
    steeringMode !== "anti_sales_pitch" &&
    steeringMode !== "anti_puppet" &&
    steeringMode !== "anti_dry_joke";
  const finalize = (candidate: string) =>
    applyBossAddressEscalation({
      inboundText: input,
      replyText: candidate,
      pidginMode,
      allow: allowBossEscalation,
    });
  if (steeringMode === "hard_stop") {
    return finalize(
      pidginMode
        ? pickVariant(input, ["I hear you. I no go text again.", "Understood. I go leave am here.", "Okay, I go step back now."])
        : pickVariant(input, ["Understood. I'll leave it here.", "Got it, I'll step back now.", "Understood. I won't push this further."]),
    );
  }

  if (steeringMode === "anti_beggi_beggi") {
    const tone = resolveAntiBeggiBeggiTone(input);
    const pidginOptions = ANTI_BEGGI_BEGGI_PIDGIN_VARIANTS[tone];
    const englishOptions = ANTI_BEGGI_BEGGI_EN_VARIANTS[tone];
    return finalize(
      pidginMode ? pickVariant(`${input}:anti_beggi_beggi:${tone}:pidgin`, pidginOptions) : pickVariant(`${input}:anti_beggi_beggi:${tone}:en`, englishOptions),
    );
  }

  if (steeringMode === "anti_sales_pitch") {
    return finalize(
      pidginMode
        ? pickVariant(input, ["I don see am, I go check am.", "Noted, I go take look and check.", "Thanks, I go check am on my side."])
        : pickVariant(input, ["Thanks for sharing. I'll take a look and check.", "Noted, I'll check it out on my end.", "I see it. I'll take a look and review."]),
    );
  }

  if (steeringMode === "anti_puppet") {
    return finalize(buildAntiPuppetReply(input, pidginMode));
  }

  if (steeringMode === "anti_dry_joke") {
    return finalize(buildDryJokeReply(input, pidginMode));
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

  if (hasLeadHandoffCue(input)) {
    return finalize(
      pidginMode
        ? pickVariant(input, [
            "Make we no overthink am, make we start with the most urgent part first.",
            "I go run with the simple option first so we fit move fast.",
            "No shaking, make we pick one and move, we fit adjust later if need be.",
          ])
        : pickVariant(input, [
            "Let's not overthink it, we should start with the most urgent part first.",
            "I'll go with the simpler option first so we can move quickly.",
            "Let's pick one and move now; we can adjust later if needed.",
          ]),
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

  if (hasAggressiveInsultCue(input)) {
    return finalize(pidginMode ? pickVariant(input, ["Sharp.", "Noted.", "Seen."]) : pickVariant(input, ["Noted.", "Seen.", "Okay."]));
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
const GPT_5_4_CONTEXT_WINDOW_TOKENS = 1_000_000;
const DEFAULT_MAX_CONTEXT_TOKENS = GPT_5_4_CONTEXT_WINDOW_TOKENS;
const DEFAULT_CONTEXT_SEARCH_LIMIT = 4;
const DEFAULT_CONTEXT_LINE_CHAR_LIMIT = 220;
const DEFAULT_ADAPTIVE_CONTEXT_MIN_TOKENS = 16_384;
const DEFAULT_CONTEXT_UTILIZATION_TARGET = 0.62;
const DEFAULT_CONTEXT_EXPANSION_LINE_STEP = 6;
const QUALITY_FIRST_CODEX_TIMEOUT_MS = 180_000;
const QUALITY_FIRST_DELAY_MIN_MS = 20_000;
const QUALITY_FIRST_DELAY_MAX_MS = 90_000;
const QUALITY_FIRST_TYPING_MIN_MS = 3_500;
const QUALITY_FIRST_TYPING_MAX_MS = 14_000;

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
  maxRetainedLines?: number;
};

type ConversationSearchInput = {
  historyLines: IndexedHistoryLine[];
  query: string;
  limit: number;
};

type ContactFactSelectionInput = {
  contactFacts: ContactMemoryFactContext[];
  query: string;
  limit: number;
};

type ResponseWorkbenchInput = {
  inboundText: string;
  recentHistory: IndexedHistoryLine[];
  relevantHistory: IndexedHistoryLine[];
  steeringMode: ConversationSteeringMode;
  pidginMode: boolean;
  oldEnglishMode: boolean;
  friendshipInference?: FriendshipCohortInference;
};

type ResponseWorkbench = {
  intentLabel: string;
  replyMode: ResponseReplyMode;
  explicitAsks: string[];
  ambiguitySignals: string[];
  confidence: number;
  personalDomain: PersonalConversationDomain;
  toneNeed: PersonalToneNeed;
  businessStyleRisk: boolean;
  emotionalCue: boolean;
  planningCue: boolean;
  friendshipCohort?: FriendshipGenerationCohort;
  friendshipCohortConfidence?: number;
  friendshipCohortSignals?: string[];
  friendshipScenario?: string;
  friendshipBridgeFallback?: boolean;
};

type PersonalConversationDomain =
  | "relationship"
  | "family"
  | "friend"
  | "plans"
  | "wellbeing"
  | "finances"
  | "work_admin"
  | "general";

type PersonalToneNeed = "empathy_first" | "direct_action" | "balanced";

function parseBoundedNumber(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.round(Math.max(min, Math.min(parsed, max)));
}

function parseBoundedFloat(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(parsed, max));
}

function suggestContextSearchLineLimit(maxContextTokens: number) {
  if (maxContextTokens >= 120_000) {
    return 16;
  }
  if (maxContextTokens >= 64_000) {
    return 12;
  }
  if (maxContextTokens >= 32_000) {
    return 8;
  }
  if (maxContextTokens >= 16_384) {
    return 6;
  }
  return DEFAULT_CONTEXT_SEARCH_LIMIT;
}

function suggestExpandedHistoryLineLimit(maxContextTokens: number) {
  if (maxContextTokens >= 120_000) {
    return 96;
  }
  if (maxContextTokens >= 64_000) {
    return 72;
  }
  if (maxContextTokens >= 32_000) {
    return 52;
  }
  if (maxContextTokens >= 16_384) {
    return 36;
  }
  return 40;
}

function extractQuestionFragments(text: string) {
  const normalized = normalizeOutboundText(text);
  if (!normalized) {
    return [];
  }
  const segments = normalized
    .split(/[?\n]/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const segment of segments) {
    if (!segment) {
      continue;
    }
    const directQuestion = /\b(can|could|would|will|should|when|where|what|why|how|which|who)\b/i.test(segment);
    if (!directQuestion) {
      continue;
    }
    out.push(segment.replace(/[.?!]+$/g, "").trim());
    if (out.length >= 4) {
      break;
    }
  }
  return out;
}

function hasAmbiguityCue(text: string) {
  const normalized = normalizeOutboundText(text);
  if (!normalized) {
    return false;
  }
  if (/\b(this|that|it|thing|stuff|one)\b/i.test(normalized) && normalized.length <= 28) {
    return true;
  }
  if (/\?{2,}/.test(normalized)) {
    return true;
  }
  if (/\b(what do you mean|which one|the one|as discussed|you know|same as before)\b/i.test(normalized)) {
    return true;
  }
  return false;
}

const FRIENDSHIP_BOOMER_SIGNAL_PATTERNS: Array<{ id: string; pattern: RegExp; weight: number }> = [
  { id: "formal_polite", pattern: /\b(kindly|please|appreciate|thank you|much appreciated)\b/i, weight: 0.9 },
  { id: "formal_greeting", pattern: /\b(good morning|good afternoon|good evening)\b/i, weight: 0.8 },
  { id: "structured_plans", pattern: /\b(let us|shall we|would you be able|at your convenience)\b/i, weight: 0.85 },
  { id: "steady_warmth", pattern: /\b(take care|bless you|glad to hear|i understand)\b/i, weight: 0.6 },
];

const FRIENDSHIP_GEN_Z_SIGNAL_PATTERNS: Array<{ id: string; pattern: RegExp; weight: number }> = [
  { id: "casual_slang", pattern: /\b(tbh|fr|ngl|lowkey|highkey|bet|vibe|for real|rn)\b/i, weight: 0.9 },
  { id: "genz_terms", pattern: /\b(bestie|bro|slaps|mood|valid|real one)\b/i, weight: 0.8 },
  { id: "casual_ack", pattern: /\b(you good|we good|i got you|say less|i'm down)\b/i, weight: 0.72 },
  { id: "all_lowercase_style", pattern: /^[^A-Z]{12,}$/m, weight: 0.38 },
];

const FRIENDSHIP_FACT_BOOMER_HINTS = /\b(retired|retirement|grand(child|kids)|church|choir|neighborhood association)\b/i;
const FRIENDSHIP_FACT_GEN_Z_HINTS = /\b(campus|semester|midterm|finals|tiktok|snapchat|discord|roommate)\b/i;

const FRIENDSHIP_SCENARIO_HINTS: Array<{ scenario: string; pattern: RegExp }> = [
  { scenario: "check_in", pattern: /\b(how have you been|checking in|you good|how are you doing)\b/i },
  { scenario: "making_plans", pattern: /\b(catch up|weekend|meet up|hang out)\b/i },
  { scenario: "reschedule", pattern: /\b(move|reschedule|another day|shift it)\b/i },
  { scenario: "emotional_support", pattern: /\b(rough day|drained|overwhelmed|stressed)\b/i },
  { scenario: "celebrate_win", pattern: /\b(got the offer|promotion|passed|won)\b/i },
  { scenario: "money_boundary", pattern: /\b(lend|loan|borrow|money right now)\b/i },
  { scenario: "friendship_drift", pattern: /\b(drifting|feel distant|we barely talk)\b/i },
  { scenario: "conflict_repair", pattern: /\b(came off harsh|hurt|misunderstood|my bad)\b/i },
];

const PROFESSIONAL_LINGUA_SIGNAL_PATTERNS: Array<{ id: string; pattern: RegExp; weight: number }> = [
  { id: "professional_greeting", pattern: /\b(good morning|good afternoon|good evening)\b/i, weight: 0.35 },
  { id: "execution_language", pattern: /\b(align|confirm|share|deliver|timeline|eta|review|update)\b/i, weight: 0.62 },
  { id: "work_keywords", pattern: /\b(client|proposal|brief|deadline|stakeholder|meeting|action item)\b/i, weight: 0.7 },
  { id: "polite_formality", pattern: /\b(please|kindly|appreciate|thank you)\b/i, weight: 0.28 },
];

function inferFriendshipScenarioHint(text: string) {
  for (const hint of FRIENDSHIP_SCENARIO_HINTS) {
    if (hint.pattern.test(text)) {
      return hint.scenario;
    }
  }
  return undefined;
}

export function inferFriendshipGenerationCohort(args: {
  inboundText: string;
  recentHistoryLines: string[];
  relevantHistoryLines: string[];
  contactFacts?: Array<{ factValue: string; factType?: string; confidence?: number }>;
}): FriendshipCohortInference {
  const inbound = normalizeOutboundText(args.inboundText).toLowerCase();
  const recent = args.recentHistoryLines.slice(-6).join(" ").toLowerCase();
  const relevant = args.relevantHistoryLines.slice(-4).join(" ").toLowerCase();
  const corpus = [inbound, recent, relevant].filter(Boolean).join(" ");
  const contactFactsText = (args.contactFacts || [])
    .slice(0, 8)
    .map((fact) => `${fact.factType || "other"} ${fact.factValue || ""}`.toLowerCase())
    .join(" ");

  let boomerScore = 0;
  let genZScore = 0;
  const boomerSignals: string[] = [];
  const genZSignals: string[] = [];

  for (const signal of FRIENDSHIP_BOOMER_SIGNAL_PATTERNS) {
    if (signal.pattern.test(corpus)) {
      boomerScore += signal.weight;
      boomerSignals.push(signal.id);
    }
  }
  for (const signal of FRIENDSHIP_GEN_Z_SIGNAL_PATTERNS) {
    if (signal.pattern.test(corpus)) {
      genZScore += signal.weight;
      genZSignals.push(signal.id);
    }
  }

  if (FRIENDSHIP_FACT_BOOMER_HINTS.test(contactFactsText)) {
    boomerScore += 0.65;
    boomerSignals.push("contact_fact_hint");
  }
  if (FRIENDSHIP_FACT_GEN_Z_HINTS.test(contactFactsText)) {
    genZScore += 0.65;
    genZSignals.push("contact_fact_hint");
  }

  if (/\b(pls|u|ur)\b/i.test(corpus)) {
    genZScore += 0.18;
    genZSignals.push("short_text_tokens");
  }
  if (/\b(i am|i have|let us)\b/i.test(corpus)) {
    boomerScore += 0.12;
    boomerSignals.push("expanded_grammar");
  }

  const scenario = inferFriendshipScenarioHint(inbound);
  const total = boomerScore + genZScore;
  const topScore = Math.max(boomerScore, genZScore);
  const diff = Math.abs(boomerScore - genZScore);
  const confidence = total <= 0 ? 0.32 : clamp01(0.45 + (topScore / (total + 0.001)) * 0.4 + Math.min(diff, 1.2) * 0.15);
  const isAmbiguous = topScore < 0.75 || diff < 0.4;

  if (isAmbiguous) {
    return {
      cohort: "bridge",
      confidence,
      signals: ["low_confidence", ...boomerSignals.slice(0, 2), ...genZSignals.slice(0, 2)].slice(0, 5),
      scenario,
      usedBridgeFallback: true,
    };
  }

  const cohort: FriendshipGenerationCohort = boomerScore >= genZScore ? "boomer" : "gen_z";
  return {
    cohort,
    confidence,
    signals: (cohort === "boomer" ? boomerSignals : genZSignals).slice(0, 5),
    scenario,
    usedBridgeFallback: false,
  };
}

export function inferProfessionalLinguaProfile(args: {
  inboundText: string;
  recentHistoryLines: string[];
  relevantHistoryLines: string[];
  personality?: PersonalityContext;
  personalDomain: PersonalConversationDomain;
  businessStyleRisk: boolean;
}): ProfessionalLinguaInference {
  const slug = (args.personality?.profileSlug || "").trim().toLowerCase();
  const profileName = (args.personality?.profileName || "").trim().toLowerCase();
  const corpus = [args.inboundText, ...args.recentHistoryLines.slice(-6), ...args.relevantHistoryLines.slice(-4)].join(" ");

  let score = 0;
  const signals: string[] = [];
  if (slug === "professional" || profileName.includes("professional")) {
    score += 1.15;
    signals.push("professional_profile_selected");
  } else if (slug === "casual") {
    score += 0.18;
    signals.push("casual_profile_selected");
  }
  if (args.personalDomain === "work_admin") {
    score += 0.72;
    signals.push("work_admin_domain");
  }
  if (args.businessStyleRisk) {
    score += 0.85;
    signals.push("business_style_risk");
  }
  for (const signal of PROFESSIONAL_LINGUA_SIGNAL_PATTERNS) {
    if (signal.pattern.test(corpus)) {
      score += signal.weight;
      signals.push(signal.id);
    }
  }

  const enabled = score >= 1.15 || ((slug === "professional" || profileName.includes("professional")) && score >= 0.9);
  const confidence = clamp01(0.35 + Math.min(score, 3) * 0.2);
  const reason =
    enabled && (slug === "professional" || profileName.includes("professional"))
      ? "profile_professional"
      : enabled
        ? "business_context"
        : "disabled";
  return {
    enabled,
    confidence,
    signals: signals.slice(0, 6),
    reason,
  };
}

function detectPersonalConversationDomain(text: string): PersonalConversationDomain {
  const normalized = normalizeOutboundText(text).toLowerCase();
  if (!normalized) {
    return "general";
  }
  if (
    /\b(miss you|love you|babe|baby|date|relationship|boyfriend|girlfriend|romantic|us two|kiss|hug)\b/i.test(normalized)
  ) {
    return "relationship";
  }
  if (
    /\b(mom|mum|mama|dad|papa|brother|sister|family|wife|husband|son|daughter|aunt|uncle|cousin|in-law)\b/i.test(normalized)
  ) {
    return "family";
  }
  if (/\b(friend|bestie|bro|sis|homie|fam)\b/i.test(normalized)) {
    return "friend";
  }
  if (
    /\b(plan|schedule|meeting|meet|tomorrow|tonight|weekend|next week|eta|available|time works|calendar|reschedule)\b/i.test(normalized)
  ) {
    return "plans";
  }
  if (/\b(stress|anxious|upset|sad|depressed|sick|hospital|therapy|overwhelmed|tired|hurt|pain|panic)\b/i.test(normalized)) {
    return "wellbeing";
  }
  if (/\b(rent|salary|budget|cash|money|transfer|owe|debt|loan|invoice|payment)\b/i.test(normalized)) {
    return "finances";
  }
  if (/\b(client|deliverable|deadline|kpi|sla|ticket|escalat|stakeholder|proposal|quote)\b/i.test(normalized)) {
    return "work_admin";
  }
  return "general";
}

function inferPersonalToneNeed(args: { inboundText: string; personalDomain: PersonalConversationDomain }): PersonalToneNeed {
  const normalized = normalizeOutboundText(args.inboundText).toLowerCase();
  if (!normalized) {
    return "balanced";
  }
  const emotionalCue =
    /\b(feel|felt|sorry|hurt|lonely|miss|worried|scared|proud|congrats|congratulations|appreciate|thanks)\b/i.test(normalized) ||
    /[!?]{2,}/.test(normalized);
  const planningCue =
    /\b(when|what time|where|how|can you|could you|please|send|share|confirm|book|schedule|set|arrange)\b/i.test(normalized) ||
    /\?/.test(normalized);

  if (args.personalDomain === "wellbeing" || (emotionalCue && !planningCue)) {
    return "empathy_first";
  }
  if (
    planningCue ||
    args.personalDomain === "plans" ||
    args.personalDomain === "finances" ||
    args.personalDomain === "work_admin"
  ) {
    return "direct_action";
  }
  return "balanced";
}

function inferPersonalContextProfile(args: {
  inboundText: string;
  recentHistory: IndexedHistoryLine[];
  relevantHistory: IndexedHistoryLine[];
}) {
  const corpus = [
    args.inboundText,
    ...args.recentHistory.slice(-6).map((line) => line.body),
    ...args.relevantHistory.slice(-4).map((line) => line.body),
  ]
    .join(" ")
    .trim();
  const personalDomain = detectPersonalConversationDomain(corpus);
  const toneNeed = inferPersonalToneNeed({
    inboundText: args.inboundText,
    personalDomain,
  });
  const emotionalCue =
    /\b(feel|felt|sorry|hurt|lonely|miss|worried|scared|proud|congrats|congratulations|appreciate|thanks|love)\b/i.test(corpus) ||
    /[!?]{2,}/.test(args.inboundText);
  const planningCue =
    /\b(when|where|time|schedule|plan|send|share|confirm|book|arrange|tomorrow|tonight|weekend|eta)\b/i.test(corpus) ||
    /\?/.test(args.inboundText);
  const businessStyleRisk = /\b(client|deliverable|deadline|kpi|sla|ticket|escalat|stakeholder|proposal|quote)\b/i.test(corpus);

  return {
    personalDomain,
    toneNeed,
    businessStyleRisk,
    emotionalCue,
    planningCue,
  };
}

function inferIntentLabel(args: { inboundText: string; steeringMode: ConversationSteeringMode }) {
  if (args.steeringMode === "hard_stop") {
    return "conversation_end";
  }
  if (args.steeringMode === "pause") {
    return "pause_for_later";
  }
  if (args.steeringMode === "wrap_up" || args.steeringMode === "loop") {
    return "close_or_ack";
  }
  if (args.steeringMode === "anti_beggi_beggi") {
    return "money_request_decline";
  }
  if (args.steeringMode === "anti_sales_pitch") {
    return "sales_pitch_close_out";
  }
  if (args.steeringMode === "anti_puppet") {
    return "anti_puppet_deflect";
  }
  if (args.steeringMode === "anti_dry_joke") {
    return "dry_joke_callout";
  }

  const inbound = normalizeOutboundText(args.inboundText);
  if (/\?/.test(inbound)) {
    return "question_or_request";
  }
  if (/\b(please|abeg|kindly|send|share|help|assist|check|review|confirm|remind)\b/i.test(inbound)) {
    return "action_request";
  }
  if (/\b(thanks|thank you|nice|great|cool|ok|okay|alright)\b/i.test(inbound)) {
    return "acknowledgement";
  }
  return "general_reply";
}

function buildResponseWorkbench(args: ResponseWorkbenchInput) {
  const startedAt = Date.now();
  const explicitAsks = extractQuestionFragments(args.inboundText);
  const ambiguitySignals: string[] = [];
  const personalContext = inferPersonalContextProfile({
    inboundText: args.inboundText,
    recentHistory: args.recentHistory,
    relevantHistory: args.relevantHistory,
  });
  if (hasAmbiguityCue(args.inboundText)) {
    ambiguitySignals.push("ambiguous_reference");
  }
  if (hasLeadHandoffCue(args.inboundText)) {
    ambiguitySignals.push("decision_handoff");
  }
  if (explicitAsks.length === 0 && /\b(can|could|would|will|should)\b/i.test(args.inboundText)) {
    ambiguitySignals.push("implicit_request_without_question_mark");
  }
  if (args.relevantHistory.length === 0 && /\b(as discussed|earlier|before|last time|follow up)\b/i.test(args.inboundText)) {
    ambiguitySignals.push("recall_requested_without_match");
  }

  let replyMode: ResponseReplyMode = "answer";
  if (
    args.steeringMode === "hard_stop" ||
    args.steeringMode === "pause" ||
    args.steeringMode === "wrap_up" ||
    args.steeringMode === "loop" ||
    args.steeringMode === "anti_beggi_beggi" ||
    args.steeringMode === "anti_sales_pitch" ||
    args.steeringMode === "anti_puppet" ||
    args.steeringMode === "anti_dry_joke"
  ) {
    replyMode = "close";
  } else if (explicitAsks.length === 0 && hasLeadHandoffCue(args.inboundText)) {
    replyMode = "lead";
  } else if (explicitAsks.length === 0 && /\b(confirm|is that fine|is that okay|still on|we good)\b/i.test(args.inboundText)) {
    replyMode = "confirm";
  } else if (ambiguitySignals.length > 0 && explicitAsks.length === 0) {
    replyMode = "clarify";
  } else if (explicitAsks.length > 0) {
    replyMode = "answer";
  }

  const confidence = clamp01(
    0.84 -
      ambiguitySignals.length * 0.17 +
      Math.min(0.1, explicitAsks.length * 0.05) +
      Math.min(0.08, args.relevantHistory.length * 0.02),
  );

  const workbench: ResponseWorkbench = {
    intentLabel: inferIntentLabel({ inboundText: args.inboundText, steeringMode: args.steeringMode }),
    replyMode,
    explicitAsks,
    ambiguitySignals,
    confidence,
    personalDomain: personalContext.personalDomain,
    toneNeed: personalContext.toneNeed,
    businessStyleRisk: personalContext.businessStyleRisk,
    emotionalCue: personalContext.emotionalCue,
    planningCue: personalContext.planningCue,
    friendshipCohort: args.friendshipInference?.cohort,
    friendshipCohortConfidence: args.friendshipInference?.confidence,
    friendshipCohortSignals: args.friendshipInference?.signals,
    friendshipScenario: args.friendshipInference?.scenario,
    friendshipBridgeFallback: args.friendshipInference?.usedBridgeFallback,
  };

  return {
    workbench,
    call: {
      name: "response_workbench" as const,
      latencyMs: Date.now() - startedAt,
      input: {
        inboundChars: args.inboundText.length,
        recentHistoryLines: args.recentHistory.length,
        relevantHistoryLines: args.relevantHistory.length,
        steeringMode: args.steeringMode,
        pidginMode: args.pidginMode,
        oldEnglishMode: args.oldEnglishMode,
      },
      output: {
        intentLabel: workbench.intentLabel,
        replyMode: workbench.replyMode,
        explicitAskCount: workbench.explicitAsks.length,
        ambiguityCount: workbench.ambiguitySignals.length,
        confidence: workbench.confidence,
        personalDomain: workbench.personalDomain,
        toneNeed: workbench.toneNeed,
        businessStyleRisk: workbench.businessStyleRisk,
        emotionalCue: workbench.emotionalCue,
        planningCue: workbench.planningCue,
        friendshipCohort: workbench.friendshipCohort,
        friendshipCohortConfidence: workbench.friendshipCohortConfidence,
        friendshipCohortSignals: workbench.friendshipCohortSignals,
        friendshipScenario: workbench.friendshipScenario,
        friendshipBridgeFallback: workbench.friendshipBridgeFallback,
      },
    },
  };
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

function scoreMicroReplyFit(replyText: string, inboundText: string) {
  const reply = normalizeOutboundText(replyText || "");
  const inbound = normalizeOutboundText(inboundText || "");
  const replyWords = countWords(reply);
  if (!reply || !inbound || replyWords === 0 || replyWords > 3) {
    return 0;
  }

  const normalizedReply = reply.toLowerCase();
  const normalizedInbound = inbound.toLowerCase();
  const inboundHasQuestion = /\?/.test(normalizedInbound);
  const binaryQuestionCue = /\b(can|could|would|will|should|do|did|is|are|am|was|were|have|has|had)\b/i.test(normalizedInbound);
  const affirmativeReply = /^(yes|yep|yeah|yup|sure|definitely|absolutely|exactly|correct|confirmed|done)$/i.test(normalizedReply);
  const negativeReply = /^(no|nope|nah|never|cannot|can't|cant|not now|later)$/i.test(normalizedReply);
  if ((affirmativeReply || negativeReply) && (inboundHasQuestion || binaryQuestionCue)) {
    return 1;
  }

  const thanksInbound = /\b(thanks|thank you|thx|ty|tnx)\b/i.test(normalizedInbound);
  const thanksReply = /^(anytime|you'?re welcome|welcome|no worries|no wahala|sure thing|all good)$/i.test(normalizedReply);
  if (thanksInbound && thanksReply) {
    return 0.94;
  }

  const apologyInbound = /\b(sorry|apolog(?:y|ize|ise)|my bad)\b/i.test(normalizedInbound);
  const apologyReply = /^(all good|no worries|no wahala|it'?s fine|its fine|you'?re fine|youre fine)$/i.test(normalizedReply);
  if (apologyInbound && apologyReply) {
    return 0.9;
  }

  const closeAckReply = /^(ok|okay|k|kk|cool|great|perfect|bet|safe|seen|sharp|we good|all good)$/i.test(normalizedReply);
  if (ACK_ONLY_PATTERNS.some((pattern) => pattern.test(normalizedInbound)) && closeAckReply) {
    return 0.84;
  }

  if (inbound.length <= 28) {
    return 0.72;
  }
  return 0;
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
  const requestedRetainedLines = Math.round(
    Math.max(
      args.historyLineLimit * 3,
      Math.min(args.maxRetainedLines ?? args.historyLineLimit * 3, 600),
    ),
  );
  const cappedLimit = Math.round(Math.max(4, Math.min(requestedRetainedLines, 600)));
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
        maxRetainedLines: cappedLimit,
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

function runContactMemoryFactSelectionTool(args: ContactFactSelectionInput) {
  const startedAt = Date.now();
  const limit = Math.round(Math.max(1, Math.min(args.limit, 8)));
  const queryKeywords = Array.from(new Set(extractKeywords(args.query))).slice(0, 20);
  const factTypeWeight: Record<ContactMemoryFactType, number> = {
    relationship: 1.1,
    schedule: 1.05,
    preference: 1,
    profile: 0.95,
    promise: 0.9,
    other: 0.8,
  };

  const scored = args.contactFacts
    .map((fact) => {
      const normalized = normalizeOutboundText(fact.factValue || "");
      if (!normalized) {
        return null;
      }
      const factKeywords = new Set(extractKeywords(normalized));
      let overlap = 0;
      for (const keyword of queryKeywords) {
        if (factKeywords.has(keyword)) {
          overlap += 1;
        }
      }
      const overlapScore = overlap * 2.2;
      const confidenceScore = clamp01(Number(fact.confidence ?? 0.55));
      const typeWeight = factTypeWeight[fact.factType] ?? 0.8;
      const score = (overlapScore + confidenceScore) * typeWeight;
      return {
        factType: fact.factType,
        factValue: normalized,
        confidence: confidenceScore,
        overlap,
        score,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const matchedCount = scored.filter((item) => item.overlap > 0).length;
  const selectedFacts =
    matchedCount > 0 ? scored.filter((item) => item.overlap > 0).slice(0, limit) : scored.slice(0, Math.min(3, limit));
  const latencyMs = Date.now() - startedAt;

  return {
    selectedFacts,
    call: {
      name: "contact_memory_fact_selection" as const,
      latencyMs,
      input: {
        queryKeywords: queryKeywords.slice(0, 12),
        availableFacts: args.contactFacts.length,
        limit,
      },
      output: {
        selectedFacts: selectedFacts.length,
        matchedFacts: matchedCount,
        selectedTypes: Array.from(new Set(selectedFacts.map((fact) => fact.factType))),
      },
    },
  };
}

function runContextWindowDetectionTool(args: ContextWindowDetectionInput) {
  const startedAt = Date.now();
  const maxContextTokens = Math.max(512, Math.min(args.maxContextTokens, GPT_5_4_CONTEXT_WINDOW_TOKENS));
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
  contactFacts?: ContactMemoryFactContext[];
  styleHints: string[];
  styleProfile?: StyleProfileContext;
  personality?: PersonalityContext;
  grounding?: GroundingContext;
  runtime?: RuntimeAiTuning;
}): PromptBuildResult {
  const maxContextTokens = Math.round(
    Math.max(
      512,
      Math.min(
        args.runtime?.maxContextTokens ??
          parseBoundedNumber(
            process.env.SLM_AI_MAX_CONTEXT_TOKENS,
            DEFAULT_MAX_CONTEXT_TOKENS,
            512,
            GPT_5_4_CONTEXT_WINDOW_TOKENS,
          ),
        GPT_5_4_CONTEXT_WINDOW_TOKENS,
      ),
    ),
  );
  const adaptiveContextMinTokens = Math.round(
    Math.max(
      2048,
      Math.min(
        args.runtime?.adaptiveContextMinTokens ??
          parseBoundedNumber(
            process.env.SLM_AI_ADAPTIVE_CONTEXT_MIN_TOKENS,
            DEFAULT_ADAPTIVE_CONTEXT_MIN_TOKENS,
            2048,
            GPT_5_4_CONTEXT_WINDOW_TOKENS,
          ),
        GPT_5_4_CONTEXT_WINDOW_TOKENS,
      ),
    ),
  );
  const largeContextMode = maxContextTokens >= adaptiveContextMinTokens;
  const historyLineLimit = Math.round(Math.max(4, Math.min(args.runtime?.historyLineLimit ?? 14, 40)));
  const contextSearchLineLimit = Math.round(
    Math.max(
      1,
      Math.min(
        args.runtime?.contextSearchLineLimit ?? suggestContextSearchLineLimit(maxContextTokens),
        24,
      ),
    ),
  );
  const maxExpandedHistoryLines = Math.round(
    Math.max(
      historyLineLimit,
      Math.min(
        largeContextMode ? suggestExpandedHistoryLineLimit(maxContextTokens) : historyLineLimit,
        180,
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
    maxRetainedLines: largeContextMode ? Math.max(historyLineLimit * 3, maxExpandedHistoryLines * 3) : undefined,
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
  let selectedContactFacts: Array<{
    factType: ContactMemoryFactType;
    factValue: string;
    confidence: number;
    overlap: number;
  }> = [];
  if (Array.isArray(args.contactFacts) && args.contactFacts.length > 0) {
    const selected = runContactMemoryFactSelectionTool({
      contactFacts: args.contactFacts,
      query: args.inboundText,
      limit: 5,
    });
    selectedContactFacts = selected.selectedFacts;
    toolCalls.push(selected.call);
  }

  const outboundSamples = cleanedHistory.cleaned
    .filter((line) => line.line.startsWith("Me:"))
    .slice(-4)
    .map((line) => line.line.replace(/^Me:\s*/, "").trim())
    .filter(Boolean)
    .join(" | ");
  const mimicryLevel = Math.min(clamp01(args.styleProfile?.mimicryLevel ?? 0.72), MAX_SAFE_MIMICRY_LEVEL);
  const mimicryInstruction =
    mimicryLevel >= 0.72
      ? "Mirror style carefully at a medium level: reflect tone and pacing, but never copy exact catchphrases, punctuation stacks, or signature wording."
      : mimicryLevel >= 0.55
        ? "Use light mirroring of tone and rhythm while keeping wording original and clear."
        : "Use a friendly, clear baseline voice with only minimal mirroring.";
  const hints = sanitizeStyleHintsForPrompt([
    ...args.styleHints,
    ...(args.styleProfile?.humorNotes || []),
    ...(args.styleProfile?.punctuationStyle || []),
    ...(args.styleProfile?.spellingNotes || []),
  ]).join(", ");
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
  const friendshipInference =
    activePersonaPack?.id === "friendship_cross_gen.v1" && (args.personality?.profileSlug || "").trim().toLowerCase() === "friendship"
      ? inferFriendshipGenerationCohort({
          inboundText: args.inboundText,
          recentHistoryLines: recentHistory.map((line) => line.line),
          relevantHistoryLines: relevantHistory.map((line) => line.line),
          contactFacts: selectedContactFacts.map((fact) => ({
            factType: fact.factType,
            factValue: fact.factValue,
            confidence: fact.confidence,
          })),
        })
      : undefined;
  const friendshipRoutingInstruction = friendshipInference
    ? friendshipInference.cohort === "boomer"
      ? "Friendship cohort route: BOOMER. Prefer clear, respectful, steady wording and avoid trendy slang."
      : friendshipInference.cohort === "gen_z"
        ? "Friendship cohort route: GEN_Z. Use naturally casual compact phrasing and light slang only when it fits the thread."
        : "Friendship cohort route: BRIDGE fallback. Use a neutral cross-generational tone with warm, plain wording."
    : "";
  const personaPackShortcuts = activePersonaPack
    ? activePersonaPack.shortcutDictionary
        .slice(0, 10)
        .map((entry) => `${entry.token}: ${entry.usageRule}`)
        .join(" | ")
    : "";
  const personaPackGuardrails = activePersonaPack ? activePersonaPack.guardrails.slice(0, 6).join(" | ") : "";
  const personaPackFewShots = activePersonaPack
    ? selectFewShotsForPrompt(activePersonaPack, 900, args.inboundText, {
        preferredCohort: friendshipInference?.cohort,
        preferredScenario: friendshipInference?.scenario,
      })
    : [];
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
  const steeringMode = detectConversationSteeringMode({
    inboundText: args.inboundText,
    historyLines: recentHistory.map((line) => line.line),
  });
  const soulModeEnabled = args.runtime?.soulModeEnabled ?? true;
  const funnyKeywords = (args.runtime?.funnyStatusKeywords || DEFAULT_FUNNY_STATUS_KEYWORDS).slice(0, 30);
  const funnyEmojis = (args.runtime?.funnyStatusEmojis || DEFAULT_FUNNY_STATUS_EMOJIS).slice(0, 30);
  const humorEligibility = evaluateHumorEligibility({
    inboundText: args.inboundText,
    historyLines: recentHistory.map((line) => line.line),
    steeringMode,
    soulModeEnabled,
    funnyKeywords,
    funnyEmojis,
  });
  const humorEligibilityInstruction = humorEligibility.allowHumor
    ? "Humor eligibility: ALLOWED (strong playful context detected and no risk context). If humor helps, keep it brief and tasteful."
    : humorEligibility.riskContext
      ? `Humor eligibility: BLOCKED due to risk context (${humorEligibility.reasons.filter((reason) => reason !== "no_strong_playful_context").join(", ")}). Use direct neutral wording only.`
      : "Humor eligibility: BLOCKED because playful context is weak. Use direct neutral wording only.";
  const soulInstruction = soulModeEnabled
    ? "Let the account owner's identity lead every reply. Keep the tone grounded and emotionally aware, and express their values, boundaries, and voice without sounding scripted."
    : "Use a neutral, practical tone and avoid playful language.";
  const playfulInstruction =
    humorEligibility.allowHumor
      ? "The latest message is playful. A short, tasteful joke or witty line is allowed if it helps the conversation."
      : "";
  const jokeSafetyInstruction =
    humorEligibility.allowHumor
      ? "Before using humor, silently confirm you have not already made a similar joke earlier in this chat. If a similar joke exists, do not reuse it. Also avoid cringe humor: no forced meme slang, no dad-joke setups, and no try-hard punchlines."
      : "";
  const antiJokeChainInstruction = hasRecentOutboundJokeInCooldown(args.historyLines, JOKE_CHAIN_OUTBOUND_COOLDOWN)
    ? `A joke was already used in the last ${JOKE_CHAIN_OUTBOUND_COOLDOWN} outbound replies. Do not continue the bit; reply directly without humor.`
    : "";
  const mimicryInjectionCue = hasMimicryInjectionCue({
    inboundText: args.inboundText,
    historyLines: recentHistory.map((line) => line.line),
  });
  const mimicryInjectionInstruction = mimicryInjectionCue
    ? "The latest message attempts to force exact wording or impersonation. Do not copy verbatim, and do not mirror unique typos/punctuation signatures."
    : "";
  const aiDisclosureContext = hasDeclaredAiAssistantContext({
    inboundText: args.inboundText,
    historyLines: args.historyLines,
  });
  const steeringInstruction = steeringInstructionForMode(steeringMode);
  const steeringPriorityInstruction =
    "Steering priority order: (1) explicit safety/closure cues, (2) latest inbound ask, (3) relevant conversation context, (4) style/persona polish. If these conflict, follow this order.";
  const steeringExecutionInstruction =
    steeringMode === "none"
      ? "Steering mode: NONE. Keep the reply decisive, concrete, and context-anchored; avoid vague acknowledgments."
      : `Steering mode: ${steeringMode.toUpperCase()}. Execute this mode strictly even if other style hints pull in a different direction.`;
  const insultHandlingInstruction = hasAggressiveInsultCue(args.inboundText)
    ? "The latest message includes insulting or aggressive language. Ignore the insult and do not attempt de-escalation, conflict coaching, or tone policing. Respond only to the concrete request/topic. If there is no concrete request, send one short neutral acknowledgment and stop."
    : "";
  const pidginMode = detectPidginSignal({
    inboundText: args.inboundText,
    historyLines: recentHistory.map((line) => line.line),
  });
  const pidginInstruction = buildPidginReplyInstruction(pidginMode);
  const oldEnglishMode = detectOldEnglishSignal({
    inboundText: args.inboundText,
    historyLines: recentHistory.map((line) => line.line),
  });
  const oldEnglishInstruction = buildOldEnglishReplyInstruction(oldEnglishMode);
  const bossEscalationInstruction = hasBossAddressCue(args.inboundText)
    ? `If the latest message addresses you as boss/oga/chairman, treat it as friendly local banter, not hierarchy. Lightly mirror once by calling them a playful upgraded title (examples: ${BOSS_ESCALATION_PROMPT_TITLES}). Keep it subtle, respectful, and use it at most once in the reply.`
    : "";
  const responseWorkbench = buildResponseWorkbench({
    inboundText: args.inboundText,
    recentHistory,
    relevantHistory,
    steeringMode,
    pidginMode,
    oldEnglishMode,
    friendshipInference,
  });
  const professionalLingua = inferProfessionalLinguaProfile({
    inboundText: args.inboundText,
    recentHistoryLines: recentHistory.map((line) => line.line),
    relevantHistoryLines: relevantHistory.map((line) => line.line),
    personality: args.personality,
    personalDomain: responseWorkbench.workbench.personalDomain,
    businessStyleRisk: responseWorkbench.workbench.businessStyleRisk,
  });
  const professionalLinguaInstruction = professionalLingua.enabled
    ? "Professional lingua mode is ON. Mirror the account owner's established professional language style from profile and thread context: concise, respectful, clear, and action-oriented."
    : "";
  const professionalLinguaCadenceInstruction = professionalLingua.enabled
    ? "Professional cadence: brief acknowledgment -> direct answer or action -> optional concrete next-step close."
    : "";
  const professionalLinguaGuardrailInstruction = professionalLingua.enabled
    ? "Avoid robotic corporate filler (for example: 'Please be informed', 'Thanks for reaching out', or rigid template phrasing). Keep it naturally human."
    : "";
  toolCalls.push(responseWorkbench.call);
  const responseWorkbenchInstruction =
    responseWorkbench.workbench.replyMode === "clarify"
      ? "Reply mode is CLARIFY. Ask one concise clarifying question before making assumptions."
      : responseWorkbench.workbench.replyMode === "confirm"
        ? "Reply mode is CONFIRM. Confirm succinctly and keep the response brief."
        : responseWorkbench.workbench.replyMode === "lead"
          ? "Reply mode is LEAD. Drive momentum: propose one concrete next step or recommendation. Ask at most one narrow question only if required to unblock action."
        : responseWorkbench.workbench.replyMode === "close"
          ? "Reply mode is CLOSE. End gracefully in one short line without reopening the topic."
          : "Reply mode is ANSWER. Give a direct answer/action-focused reply grounded in the latest ask.";
  const responseWorkbenchSummary = [
    `Intent label: ${responseWorkbench.workbench.intentLabel}`,
    `Reply mode: ${responseWorkbench.workbench.replyMode}`,
    `Personal domain: ${responseWorkbench.workbench.personalDomain}`,
    `Tone need: ${responseWorkbench.workbench.toneNeed}`,
    `Business-style risk: ${responseWorkbench.workbench.businessStyleRisk ? "yes" : "no"}`,
    responseWorkbench.workbench.friendshipCohort
      ? `Friendship cohort: ${responseWorkbench.workbench.friendshipCohort}`
      : "Friendship cohort: n/a",
    typeof responseWorkbench.workbench.friendshipCohortConfidence === "number"
      ? `Friendship cohort confidence: ${Math.round(responseWorkbench.workbench.friendshipCohortConfidence * 100)}%`
      : "Friendship cohort confidence: n/a",
    responseWorkbench.workbench.friendshipScenario
      ? `Friendship scenario hint: ${responseWorkbench.workbench.friendshipScenario}`
      : "Friendship scenario hint: n/a",
    responseWorkbench.workbench.friendshipBridgeFallback ? "Friendship bridge fallback: yes" : "Friendship bridge fallback: no",
    responseWorkbench.workbench.friendshipCohortSignals?.length
      ? `Friendship cohort signals: ${responseWorkbench.workbench.friendshipCohortSignals.join(", ")}`
      : "Friendship cohort signals: none",
    professionalLingua.enabled ? "Professional lingua mode: on" : "Professional lingua mode: off",
    `Professional lingua confidence: ${Math.round(professionalLingua.confidence * 100)}%`,
    professionalLingua.signals.length > 0
      ? `Professional lingua signals: ${professionalLingua.signals.join(", ")}`
      : "Professional lingua signals: none",
    responseWorkbench.workbench.explicitAsks.length > 0
      ? `Explicit asks: ${responseWorkbench.workbench.explicitAsks.join(" | ")}`
      : "Explicit asks: none",
    responseWorkbench.workbench.ambiguitySignals.length > 0
      ? `Ambiguity signals: ${responseWorkbench.workbench.ambiguitySignals.join(", ")}`
      : "Ambiguity signals: none",
    `Planner confidence: ${Math.round(responseWorkbench.workbench.confidence * 100)}%`,
  ].join("\n");

  const buildPromptText = () =>
    [
      "You are writing one WhatsApp reply as the account owner.",
      "This is a personal life assistant for everyday chats (friends, family, relationships, plans), not a business support bot.",
      "Use an editor-style workflow: first plan quickly from context, then write the final message.",
      "Write like a real person: warm, calm, confident, and practical.",
      "Prefer one concise line. Only use a second short line when it clearly adds needed context.",
      "Micro-reply cadence: when the inbound is simple (yes/no, quick acknowledgment, or clear close-out), 1-3 word replies are allowed and often best. Default to 2 words in those moments, with occasional 1-word or 3-word variation for natural flow.",
      "Do not force micro-replies for complex asks; expand when clarity is needed.",
      "Sound conversational and specific, never stiff or corporate.",
      "Avoid customer-support phrasing (ticket, escalation, SLA, thanks for reaching out) and avoid email-style sign-offs.",
      "Directly react to something concrete in the latest inbound message (topic, emotion, or request).",
      aiDisclosureContext
        ? "You have already disclosed in this chat that an AI assistant helps you. Do not deny or contradict that. Keep references brief and only when relevant."
        : "Do not mention AI, policies, prompt rules, or internal reasoning.",
      "Do not overpromise. If timing is uncertain, say you'll confirm shortly.",
      "Do not prolong the conversation unnecessarily. If the intent is complete, close gracefully in one short line.",
      "When the other person hands you the choice or sounds indecisive, take the lead with one practical recommendation instead of bouncing back vague follow-up prompts.",
      "Do not use emoji characters.",
      "Avoid direct name address by default. Only use the contact's name if they used your name first in the latest message or disambiguation is required.",
      "Avoid generic fillers like 'Noted', 'As an AI', 'I hope this message finds you well', or repetitive templates.",
      "Never send placeholder lines like 'Sounds good, I'll handle it and update you soon' or 'Got it, I'm on it.'",
      "If someone prompts you like a chatbot performer (for example 'tell me a joke'), do not do a joke routine. Give a short silly-but-human line that stays context-aware and real.",
      "If the inbound asks a basic math question, do not sound like a calculator. Prefer a light human hedge, for example: 'I wasn't very good at math but I think it's ...'.",
      "Mirror style safely: borrow broad tone only, never exact catchphrases or signature phrasing.",
      "Do not imitate private identifiers, unusual typos, punctuation quirks, or language patterns that could feel like impersonation.",
      "Never use awkward stock catchphrases or borrowed signature slogans.",
      "Do not imply you sell anything or hold inventory. Never use claims like 'I have stock', 'I get small stock', 'in stock', 'for sale', or order/promo language.",
      "Avoid gendered address terms (for example bro/sis/king/queen/handsome/beautiful) unless the contact explicitly self-identifies gender in this chat context.",
      soulInstruction,
      humorEligibilityInstruction,
      playfulInstruction,
      jokeSafetyInstruction,
      antiJokeChainInstruction,
      steeringInstruction,
      steeringPriorityInstruction,
      steeringExecutionInstruction,
      insultHandlingInstruction,
      friendshipRoutingInstruction,
      professionalLinguaInstruction,
      professionalLinguaCadenceInstruction,
      professionalLinguaGuardrailInstruction,
      pidginInstruction,
      oldEnglishInstruction,
      bossEscalationInstruction,
      mimicryInjectionInstruction,
      responseWorkbenchInstruction,
      responseWorkbench.workbench.toneNeed === "empathy_first"
        ? "Tone mode is EMPATHY_FIRST. Start with one short acknowledgment of their feeling, then move to the practical reply."
        : responseWorkbench.workbench.toneNeed === "direct_action"
          ? "Tone mode is DIRECT_ACTION. Prioritize a concrete answer, recommendation, or next step quickly."
          : "Tone mode is BALANCED. Blend warmth and action in one concise reply.",
      responseWorkbench.workbench.businessStyleRisk
        ? professionalLingua.enabled
          ? "Keep wording professional but human: precise, respectful, and practical without sounding like a support macro."
          : "Keep wording personal and human; avoid sounding like account management, customer support, or business ops."
        : "",
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
      selectedContactFacts.length > 0
        ? `Known personal context about this contact (use naturally only if relevant):\n${selectedContactFacts
            .map((fact) => `- ${fact.factType}: ${fact.factValue}`)
            .join("\n")}`
        : "",
      hints ? `Style hints: ${hints}` : "",
      phrases ? `Optional lexical fingerprints (inspiration only, do not copy verbatim): ${phrases}` : "",
      outboundSamples ? `Recent sent-message examples: ${outboundSamples}` : "",
      `Pre-response workbench:\n${responseWorkbenchSummary}`,
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

  const availablePromptTokens = Math.max(128, maxContextTokens - reserveOutputTokens);
  const utilizationTarget = parseBoundedFloat(
    String(args.runtime?.contextUtilizationTarget ?? process.env.SLM_AI_CONTEXT_UTILIZATION_TARGET),
    DEFAULT_CONTEXT_UTILIZATION_TARGET,
    0.35,
    0.9,
  );
  const expansionLineStep = Math.round(
    Math.max(
      1,
      Math.min(
        args.runtime?.contextExpansionLineStep ??
          parseBoundedNumber(
            process.env.SLM_AI_CONTEXT_EXPANSION_LINE_STEP,
            DEFAULT_CONTEXT_EXPANSION_LINE_STEP,
            1,
            24,
          ),
        24,
      ),
    ),
  );
  if (
    largeContextMode &&
    detection.stats.overflowTokens === 0 &&
    recentHistory.length < maxExpandedHistoryLines &&
    detection.stats.estimatedPromptTokens / availablePromptTokens < utilizationTarget
  ) {
    const usedIndices = new Set([...recentHistory, ...relevantHistory].map((line) => line.index));
    const expandableHistory = cleanedHistory.cleaned.filter((line) => !usedIndices.has(line.index));
    let expandedLines = 0;
    let iterations = 0;
    while (
      detection.stats.overflowTokens === 0 &&
      detection.stats.estimatedPromptTokens / availablePromptTokens < utilizationTarget &&
      recentHistory.length < maxExpandedHistoryLines &&
      expandableHistory.length > 0 &&
      iterations < 40
    ) {
      iterations += 1;
      const remainingSlots = Math.max(0, maxExpandedHistoryLines - recentHistory.length);
      if (remainingSlots <= 0) {
        break;
      }
      const batchSize = Math.min(expansionLineStep, remainingSlots, expandableHistory.length);
      if (batchSize <= 0) {
        break;
      }

      const previousRecent = recentHistory;
      const previousDetection = detection;
      const batch = expandableHistory.splice(Math.max(0, expandableHistory.length - batchSize), batchSize);
      recentHistory = [...batch, ...recentHistory].sort((left, right) => left.index - right.index);
      prompt = buildPromptText();
      const expandedDetection = runContextWindowDetectionTool({
        prompt,
        maxContextTokens,
        reserveOutputTokens,
        usedHistoryLines: recentHistory.length,
        relevantHistoryLines: relevantHistory.length,
      });

      if (expandedDetection.stats.overflowTokens > 0) {
        recentHistory = previousRecent;
        detection = previousDetection;
        break;
      }

      detection = expandedDetection;
      expandedLines += batch.length;
    }

    if (expandedLines > 0) {
      toolCalls.push({
        ...detection.call,
        input: {
          ...detection.call.input,
          mode: "post_expand",
          utilizationTarget,
          expansionLineStep,
          expandedLines,
          maxExpandedHistoryLines,
        },
      });
    }
  }

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

function stripSalesInventoryClaims(text: string) {
  const parts = normalizeOutboundText(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return "";
  }

  const kept = parts.filter((part) => !SALES_INVENTORY_CLAIM_PATTERNS.some((pattern) => pattern.test(part)));
  if (kept.length === 0) {
    return "";
  }

  return normalizeOutboundText(kept.join(" "));
}

function hasDeclaredAiAssistantContext(args: { inboundText: string; historyLines?: string[] }) {
  const inbound = normalizeOutboundText(args.inboundText || "");
  const history = (args.historyLines || []).join(" ");
  const context = normalizeOutboundText(`${inbound} ${history}`.trim());
  if (!context) {
    return false;
  }
  return AI_DISCLOSURE_PATTERNS.some((pattern) => pattern.test(context));
}

function stripAiDisclosureContradictions(text: string, aiDeclared: boolean) {
  if (!aiDeclared) {
    return normalizeOutboundText(text);
  }

  const parts = normalizeOutboundText(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return "";
  }

  const kept = parts.filter((part) => !AI_DENIAL_PATTERNS.some((pattern) => pattern.test(part)));
  if (kept.length === 0) {
    return "";
  }
  return normalizeOutboundText(kept.join(" "));
}

function inferKnownGenderFromContext(args: { inboundText: string; historyLines?: string[] }): "male" | "female" | null {
  const inbound = normalizeOutboundText(args.inboundText || "");
  const themHistory = (args.historyLines || [])
    .filter((line) => /^Them:\s*/i.test(line))
    .map((line) => line.replace(/^Them:\s*/i, "").trim())
    .filter(Boolean)
    .join(" ");
  const context = normalizeOutboundText(`${inbound} ${themHistory}`.trim()).toLowerCase();
  if (!context) {
    return null;
  }

  const maleSignals = [
    /\b(?:i am|i'm|im)\s+(?:a\s+)?(?:man|male|guy|boy)\b/i,
    /\b(?:as a|being a)\s+(?:man|male|guy)\b/i,
    /\b(?:my pronouns are|pronouns:\s*)(?:he\/him|he him)\b/i,
    /\b(?:i use|use)\s+(?:he\/him|he him)\b/i,
  ];
  const femaleSignals = [
    /\b(?:i am|i'm|im)\s+(?:a\s+)?(?:woman|female|girl|lady)\b/i,
    /\b(?:as a|being a)\s+(?:woman|female|girl|lady)\b/i,
    /\b(?:my pronouns are|pronouns:\s*)(?:she\/her|she her)\b/i,
    /\b(?:i use|use)\s+(?:she\/her|she her)\b/i,
  ];

  const male = maleSignals.some((pattern) => pattern.test(context));
  const female = femaleSignals.some((pattern) => pattern.test(context));
  if (male === female) {
    return null;
  }
  return male ? "male" : "female";
}

function hasJokeContextCue(args: { inboundText: string; historyLines?: string[]; replyText: string }) {
  const context = `${args.inboundText || ""} ${(args.historyLines || []).join(" ")} ${args.replyText || ""}`.toLowerCase();
  if (!context.trim()) {
    return false;
  }
  return /\b(lol|lmao|lmfao|haha|hehe|joke|jokes|banter|roast|tease|teasing|playful|cruise)\b/i.test(context) || /[😂🤣😅😆😄😁😜🤪🙃]/u.test(context);
}

function stripGenderedWording(text: string, knownGender: "male" | "female" | null, allowRoyalJokeTerms: boolean) {
  const baseTerms =
    knownGender === "male"
      ? FEMALE_GENDERED_TERMS
      : knownGender === "female"
        ? MALE_GENDERED_TERMS
        : [...MALE_GENDERED_TERMS, ...FEMALE_GENDERED_TERMS];
  const terms = allowRoyalJokeTerms ? baseTerms.filter((term) => !ROYAL_JOKE_TERMS.has(term.toLowerCase())) : baseTerms;

  if (terms.length === 0) {
    return normalizeOutboundText(text);
  }

  const escaped = terms.map((term) => escapeRegex(term)).join("|");
  const pattern = new RegExp(`(^|[\\s,!.?;:])(?:${escaped})(?=$|[\\s,!.?;:])`, "gi");
  const withoutTerms = text.replace(pattern, (match, prefix: string) => (prefix || " "));
  return normalizeOutboundText(
    withoutTerms
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/^[,.;:!?]\s*/, "")
      .trim(),
  );
}

function applyAntiPuppetTone(args: { inboundText: string; replyText: string; pidginMode: boolean }) {
  const reply = normalizeOutboundText(args.replyText || "");
  if (!reply) {
    return reply;
  }
  if (!hasPuppetJokeRequestCue(args.inboundText)) {
    return reply;
  }
  return buildAntiPuppetReply(args.inboundText, args.pidginMode);
}

function isLikelyMathInbound(text: string) {
  const normalized = normalizeOutboundText(text || "").toLowerCase();
  if (!normalized) {
    return false;
  }
  const hasDigits = /\d/.test(normalized);
  const hasWordNumber = MATH_WORD_NUMBER_PATTERN.test(normalized);
  if (!hasDigits && !hasWordNumber) {
    return false;
  }
  const hasMathCue = MATH_CUE_PATTERNS.some((pattern) => pattern.test(normalized));
  const hasOperatorExpression = MATH_OPERATOR_EXPRESSION_PATTERN.test(normalized);
  const hasLinearEquation = MATH_LINEAR_EQUATION_PATTERN.test(normalized);
  const asksForResult = /\?/.test(normalized) || MATH_DIRECT_ASK_PATTERN.test(normalized);
  return ((hasOperatorExpression || hasLinearEquation) && asksForResult) || (hasMathCue && (hasDigits || hasWordNumber));
}

function looksCalculatorStyleReply(text: string) {
  const normalized = normalizeOutboundText(text || "");
  if (!normalized) {
    return false;
  }
  return CALCULATOR_STYLE_REPLY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function extractMathResultToken(text: string) {
  const normalized = normalizeOutboundText(text || "");
  if (!normalized) {
    return "";
  }
  const expressionResultMatch = normalized.match(/=\s*(-?\d[\d,]*(?:\.\d+)?(?:\s*%| percent)?)(?:[.!?])?$/i);
  if (expressionResultMatch?.[1]) {
    return expressionResultMatch[1].trim();
  }
  const canonicalValueMatch = normalized.match(/-?\d[\d,]*(?:\.\d+)?(?:\s*%| percent)?/i);
  if (canonicalValueMatch?.[0]) {
    return canonicalValueMatch[0].trim();
  }
  return normalized.replace(/[.!?]+$/g, "").trim();
}

function applyAntiCalculatorMathTone(args: { inboundText: string; replyText: string }) {
  const reply = normalizeOutboundText(args.replyText || "");
  if (!reply) {
    return reply;
  }
  if (!isLikelyMathInbound(args.inboundText) || !looksCalculatorStyleReply(reply)) {
    return reply;
  }
  if (/\bi\s+(?:wasn(?:'|’)t|am not|i'm not)\s+(?:very\s+)?good\s+at\s+math\b/i.test(reply)) {
    return reply;
  }

  const core = reply
    .replace(/^=?\s*/i, "")
    .replace(/^(?:the answer is|it(?:'|’)s|it is|equals?)\s*/i, "")
    .replace(/^(?:result|answer)\s*[:\-]\s*/i, "")
    .trim();
  const resolved = extractMathResultToken(core || reply);
  if (!resolved) {
    return reply;
  }
  const seed = `${args.inboundText}:${resolved}:anti_calculator_math`;
  const opener = pickVariant(`${seed}:opener`, ANTI_CALCULATOR_MATH_OPENERS);
  const endingTemplate = pickVariant(`${seed}:ending`, ANTI_CALCULATOR_MATH_ENDINGS);
  const ending = endingTemplate.includes("{{result}}") ? endingTemplate.replace("{{result}}", resolved) : endingTemplate;
  const variant = `${opener}, ${ending}`;
  return normalizeOutboundText(variant);
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
  preserveEmojis?: boolean;
}) {
  const fallback = (args.fallbackText || "All good.").trim() || "All good.";
  const normalizedInput = normalizeOutboundText(args.text || "");
  const withoutEmoji = args.preserveEmojis ? normalizedInput : stripEmojiCharacters(normalizedInput);
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
    allow:
      steeringMode !== "hard_stop" &&
      steeringMode !== "anti_beggi_beggi" &&
      steeringMode !== "anti_sales_pitch" &&
      steeringMode !== "anti_puppet" &&
      steeringMode !== "anti_dry_joke",
  });
  const oldEnglishMode = detectOldEnglishSignal({
    inboundText: args.inboundText,
    historyLines: args.historyLines || [],
  });
  const withOldEnglishMirror = applyOldEnglishMirror(withBossEscalation, oldEnglishMode);
  const withoutSalesClaims = stripSalesInventoryClaims(withOldEnglishMirror);
  const aiDeclared = hasDeclaredAiAssistantContext({
    inboundText: args.inboundText,
    historyLines: args.historyLines || [],
  });
  const withoutAiContradiction = stripAiDisclosureContradictions(withoutSalesClaims, aiDeclared);
  const jokeContext = hasJokeContextCue({
    inboundText: args.inboundText,
    historyLines: args.historyLines || [],
    replyText: args.text || "",
  });
  const knownGender = inferKnownGenderFromContext({
    inboundText: args.inboundText,
    historyLines: args.historyLines || [],
  });
  const withoutGenderedWording = stripGenderedWording(withoutAiContradiction, knownGender, jokeContext);
  const withoutAwkwardCatchphrase = stripAwkwardCatchphrases(withoutGenderedWording);
  const withAntiPuppetTone = applyAntiPuppetTone({
    inboundText: args.inboundText,
    replyText: withoutAwkwardCatchphrase,
    pidginMode,
  });
  const withAntiCalculatorTone = applyAntiCalculatorMathTone({
    inboundText: args.inboundText,
    replyText: withAntiPuppetTone,
  });
  const shouldForceCloseOut =
    shouldForceNoFollowUpQuestion(steeringMode) &&
    (/\?/.test(withAntiCalculatorTone) || hasCloseModeReopenCue(withAntiCalculatorTone));
  const withoutFollowUpQuestion = shouldForceCloseOut
    ? normalizeOutboundText(heuristicReply(args.inboundText, args.historyLines || []))
    : withAntiCalculatorTone;
  const finalText = withoutFollowUpQuestion || fallback;
  return hasAwkwardCatchphrase(finalText) ? fallback : finalText;
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

function tokenizePlainText(text: string) {
  return normalizeLineForComparison(text)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function hasAwkwardCatchphrase(text: string) {
  const normalized = normalizeOutboundText(text || "");
  if (!normalized) {
    return false;
  }
  if (AWKWARD_CATCHPHRASE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const tokens = tokenizePlainText(normalized);
  if (tokens.length === 0) {
    return false;
  }

  const startsPolite = tokens[0] === "please" || tokens[0] === "kindly" || tokens[0] === "abeg";
  const hasAllowLikeVerb = tokens.includes("allow") || tokens.includes("pardon");
  const hasMe = tokens.includes("me");
  const hasSmall = tokens.includes("small");
  return (startsPolite && hasAllowLikeVerb && hasMe) || (hasAllowLikeVerb && hasMe && hasSmall);
}

function isLowSignalMimicryPhrase(value: string) {
  const tokens = tokenizePlainText(value);
  if (tokens.length === 0) {
    return true;
  }
  const contentTokens = tokens.filter(
    (token) => token.length > 2 && !STOPWORDS.has(token) && !MIMICRY_LOW_SIGNAL_TOKENS.has(token),
  );
  if (contentTokens.length === 0) {
    return true;
  }
  if (tokens.length <= 4 && contentTokens.length <= 1 && (tokens.includes("me") || tokens[0] === "please" || tokens[0] === "kindly" || tokens[0] === "abeg")) {
    return true;
  }
  return false;
}

function sanitizeStyleHintsForPrompt(hints: string[]) {
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const rawHint of hints) {
    const hint = normalizeTraitLikeText(rawHint);
    if (!hint) {
      continue;
    }
    const key = hint.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    if (hint.length > 140) {
      continue;
    }
    if (hasAwkwardCatchphrase(hint)) {
      continue;
    }
    if (isLowSignalMimicryPhrase(hint)) {
      continue;
    }
    if (STYLE_MIMICRY_BLOCK_PATTERNS.some((pattern) => pattern.test(hint))) {
      continue;
    }
    seen.add(key);
    cleaned.push(hint);
    if (cleaned.length >= 12) {
      break;
    }
  }
  return cleaned;
}

function normalizeTraitLikeText(value: string) {
  return normalizeOutboundText(value || "").replace(/\s+/g, " ").trim();
}

function stripAwkwardCatchphrases(text: string) {
  const normalized = normalizeOutboundText(text || "");
  if (!normalized) {
    return "";
  }
  const stripped = normalized
    .replace(/\b(?:please|kindly|abeg)\s+(?:just\s+)?(?:allow|pardon)\s+me(?:\s+small)?\b[\s,;:-]*/gi, "")
    .replace(/\b(?:allow|pardon)\s+me\s+small\b[\s,;:-]*/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[,.;:!?-]\s*/, "")
    .trim();
  return normalizeOutboundText(stripped);
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

function tokenizeForComparison(text: string) {
  return normalizeLineForComparison(text)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function longestCommonTokenRun(left: string, right: string) {
  const leftTokens = tokenizeForComparison(left);
  const rightTokens = tokenizeForComparison(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }
  const row = new Array(rightTokens.length + 1).fill(0);
  let longest = 0;
  for (let i = 1; i <= leftTokens.length; i += 1) {
    for (let j = rightTokens.length; j >= 1; j -= 1) {
      if (leftTokens[i - 1] === rightTokens[j - 1]) {
        row[j] = row[j - 1] + 1;
        if (row[j] > longest) {
          longest = row[j];
        }
      } else {
        row[j] = 0;
      }
    }
  }
  return longest;
}

function commonPrefixRatio(left: string, right: string) {
  const a = normalizeLineForComparison(left);
  const b = normalizeLineForComparison(right);
  if (!a || !b) {
    return 0;
  }
  const max = Math.min(a.length, b.length);
  let matched = 0;
  for (let index = 0; index < max; index += 1) {
    if (a[index] !== b[index]) {
      break;
    }
    matched += 1;
  }
  return matched / Math.max(Math.min(a.length, b.length), 1);
}

function collectInboundCopyRiskSources(inboundText: string, historyLines: string[]) {
  const sources: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const normalized = normalizeLineForComparison(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    sources.push(value.trim());
  };

  push(inboundText);
  const recentInbound = historyLines
    .slice(-10)
    .map((line) => parseHistoryLine(line))
    .filter((line) => line.label === "Them" && line.body.trim().length > 0)
    .map((line) => line.body)
    .slice(-6);
  for (const inbound of recentInbound) {
    push(inbound);
  }

  return sources;
}

export function evaluateCopyRisk(args: { replyText: string; inboundText: string; historyLines: string[] }): CopyRiskResult {
  const candidate = normalizeLineForComparison(args.replyText || "");
  if (!candidate || candidate.length < COPY_RISK_MIN_CHARS) {
    return {
      blocked: false,
      reason: "",
      lexicalSimilarity: 0,
      longestTokenRun: 0,
    };
  }

  const sources = collectInboundCopyRiskSources(args.inboundText, args.historyLines);
  let highestSimilarity = 0;
  let highestRun = 0;
  let highestSource = "";

  for (const source of sources) {
    const normalizedSource = normalizeLineForComparison(source);
    if (!normalizedSource) {
      continue;
    }

    const lexicalSimilarity = keywordJaccardSimilarity(candidate, normalizedSource);
    const tokenRun = longestCommonTokenRun(candidate, normalizedSource);
    const prefixRatio = commonPrefixRatio(candidate, normalizedSource);
    if (lexicalSimilarity > highestSimilarity) {
      highestSimilarity = lexicalSimilarity;
      highestRun = tokenRun;
      highestSource = source;
    }

    const minLength = Math.min(candidate.length, normalizedSource.length);
    if (candidate === normalizedSource && minLength >= 18) {
      return {
        blocked: true,
        reason: "Reply copies inbound wording verbatim.",
        matchedSource: source,
        lexicalSimilarity: 1,
        longestTokenRun: tokenRun,
      };
    }
    if (minLength >= 32 && (candidate.includes(normalizedSource) || normalizedSource.includes(candidate))) {
      return {
        blocked: true,
        reason: "Reply closely copies inbound phrasing span.",
        matchedSource: source,
        lexicalSimilarity: lexicalSimilarity || 0.99,
        longestTokenRun: tokenRun,
      };
    }
    if (lexicalSimilarity >= COPY_RISK_HIGH_SIMILARITY_THRESHOLD && tokenRun >= 5) {
      return {
        blocked: true,
        reason: "Reply is too lexically similar to inbound phrasing.",
        matchedSource: source,
        lexicalSimilarity,
        longestTokenRun: tokenRun,
      };
    }
    if (lexicalSimilarity >= COPY_RISK_MEDIUM_SIMILARITY_THRESHOLD && tokenRun >= 7) {
      return {
        blocked: true,
        reason: "Reply reuses too much contiguous inbound wording.",
        matchedSource: source,
        lexicalSimilarity,
        longestTokenRun: tokenRun,
      };
    }
    if (prefixRatio >= 0.86 && minLength >= 34) {
      return {
        blocked: true,
        reason: "Reply starts with near-identical inbound wording.",
        matchedSource: source,
        lexicalSimilarity,
        longestTokenRun: tokenRun,
      };
    }
  }

  return {
    blocked: false,
    reason: "",
    matchedSource: highestSource || undefined,
    lexicalSimilarity: highestSimilarity,
    longestTokenRun: highestRun,
  };
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

type JokeGuardrailOptions = {
  inboundText?: string;
  funnyKeywords?: string[];
  funnyEmojis?: string[];
};

function hasHumorEligibleContext(args: {
  inboundText?: string;
  historyLines: string[];
  funnyKeywords: string[];
  funnyEmojis: string[];
}) {
  const inbound = normalizeOutboundText(args.inboundText || "");
  if (inbound && hasHumorSignal(inbound, args.funnyKeywords, args.funnyEmojis)) {
    return true;
  }

  const recentInboundSample = args.historyLines
    .slice(-8)
    .map((line) => parseHistoryLine(line))
    .filter((line) => line.label === "Them")
    .map((line) => line.body)
    .join(" ");
  if (recentInboundSample && hasHumorSignal(recentInboundSample, args.funnyKeywords, args.funnyEmojis)) {
    return true;
  }
  return false;
}

export function evaluateJokeGuardrail(text: string, historyLines: string[] = [], options?: JokeGuardrailOptions): JokeGuardrailResult {
  if (!isJokeLike(text)) {
    return {
      blocked: false,
      reason: "",
      code: "none",
    };
  }
  if (options?.inboundText !== undefined) {
    const funnyKeywords = (options.funnyKeywords || DEFAULT_FUNNY_STATUS_KEYWORDS).slice(0, 30);
    const funnyEmojis = (options.funnyEmojis || DEFAULT_FUNNY_STATUS_EMOJIS).slice(0, 30);
    if (
      !hasHumorEligibleContext({
        inboundText: options.inboundText,
        historyLines,
        funnyKeywords,
        funnyEmojis,
      })
    ) {
      return {
        blocked: true,
        reason: "Humor blocked because inbound context is not strongly playful.",
        code: "unsupported_context",
      };
    }
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
  if (hasAwkwardCatchphrase(normalized)) {
    return true;
  }
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
    const phrase = normalizeTraitLikeText(rawPhrase);
    const wordCount = phrase ? phrase.split(/\s+/).length : 0;
    if (!phrase) {
      continue;
    }
    if (wordCount > STYLE_MAX_PROMPT_PHRASE_WORDS) {
      continue;
    }
    const normalized = phrase.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    if (hasAwkwardCatchphrase(phrase)) {
      continue;
    }
    if (isLowSignalMimicryPhrase(phrase)) {
      continue;
    }
    if (LOW_VALUE_GENERIC_PHRASE_PATTERNS.some((pattern) => pattern.test(normalized))) {
      continue;
    }
    if (AWKWARD_CATCHPHRASE_PATTERNS.some((pattern) => pattern.test(normalized))) {
      continue;
    }
    if (STYLE_MIMICRY_BLOCK_PATTERNS.some((pattern) => pattern.test(phrase))) {
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

  const contextScoreBase =
    inboundKeywords.size === 0
      ? 0.78
      : Math.max(0, Math.min(shared / Math.max(Math.min(inboundKeywords.size, 3), 1), 1));
  const microReplyFit = scoreMicroReplyFit(text, inbound);
  const contextScore = Math.max(contextScoreBase, microReplyFit);
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
  const brevityScore = words === 0 ? 0.1 : words <= 3 ? 1 : words <= 24 ? 1 : words <= 36 ? 0.72 : 0.38;

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
    let tokenUsage: ReturnType<typeof extractTokenUsageFromProviderPayload> = null;
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
      const payload = await response.json();
      tokenUsage = extractTokenUsageFromProviderPayload(payload);
      rawText = extractAzureResponsesText(payload);
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
      const payload = await response.json();
      tokenUsage = extractTokenUsageFromProviderPayload(payload);
      rawText = extractAzureChatCompletionText(payload);
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
      ...enrichAttemptWithUsage({
        provider: "azure",
        model: cfg.model,
        usageSource: "provider",
        ...(tokenUsage || {}),
      }),
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
      timeout: Math.round(Math.max(20_000, Math.min(args.runtime?.codexTimeoutMs ?? QUALITY_FIRST_CODEX_TIMEOUT_MS, 300_000))),
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
          ...enrichAttemptWithUsage({
            provider: "codex",
            model,
            usageSource: "estimated",
            inputTokens: estimateTextTokens(prompt),
            outputTokens: estimateTextTokens(rawText),
          }),
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

async function rewriteCopyRiskReplyOnce(args: {
  candidateText: string;
  inboundText: string;
  historyLines: string[];
  basePrompt: string;
  runtime?: RuntimeAiTuning;
  copyRisk: CopyRiskResult;
}) {
  const sourceHint = args.copyRisk.matchedSource ? normalizeOutboundText(args.copyRisk.matchedSource).slice(0, 180) : "";
  const rewritePrompt = [
    args.basePrompt,
    `Current draft reply: ${args.candidateText}`,
    `Copy-risk guardrail: ${args.copyRisk.reason}`,
    sourceHint ? `Inbound/source phrase to avoid copying: ${sourceHint}` : "",
    "Rewrite with the same meaning but clearly different wording, order, and phrasing.",
    "Do not copy contiguous fragments from inbound text. Keep it concise and natural.",
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
  guardrailInstruction?: string;
}) {
  const guardrailInstruction =
    args.guardrailInstruction ||
    `The last ${JOKE_CHAIN_OUTBOUND_COOLDOWN} outbound replies already include humor. Rewrite this into a direct, non-joke response.`;
  const rewritePrompt = [
    args.basePrompt,
    `Current draft reply: ${args.candidateText}`,
    guardrailInstruction,
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

function toTokenCount(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return Math.round(parsed);
}

function normalizeTokenUsage(args: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}) {
  const inputTokens = toTokenCount(args.inputTokens);
  const outputTokens = toTokenCount(args.outputTokens);
  const fallbackTotal = (inputTokens ?? 0) + (outputTokens ?? 0);
  const totalTokens = toTokenCount(args.totalTokens) ?? (fallbackTotal > 0 ? fallbackTotal : undefined);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return null;
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

function readUsageValue(usage: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = toTokenCount(usage[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function extractTokenUsageFromProviderPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const usage = (payload as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") {
    return null;
  }
  const usageRecord = usage as Record<string, unknown>;
  return normalizeTokenUsage({
    inputTokens: readUsageValue(usageRecord, ["input_tokens", "prompt_tokens", "inputTokens", "promptTokens"]),
    outputTokens: readUsageValue(usageRecord, ["output_tokens", "completion_tokens", "outputTokens", "completionTokens"]),
    totalTokens: readUsageValue(usageRecord, ["total_tokens", "totalTokens"]),
  });
}

function normalizeModelEnvKey(model: string) {
  return model
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function readCostPerMillion(args: {
  provider: "azure" | "codex" | "heuristic";
  model: string;
  direction: "input" | "output";
}) {
  const normalizedModel = normalizeModelEnvKey(args.model);
  const perModelKey = `SLM_AI_COST_${normalizedModel}_${args.direction.toUpperCase()}_PER_1M_USD`;
  const perProviderKey = `SLM_AI_COST_${args.provider.toUpperCase()}_${args.direction.toUpperCase()}_PER_1M_USD`;
  const globalKey = `SLM_AI_COST_DEFAULT_${args.direction.toUpperCase()}_PER_1M_USD`;
  const raw = process.env[perModelKey] || process.env[perProviderKey] || process.env[globalKey];
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function estimateCostUsd(args: {
  provider: "azure" | "codex" | "heuristic";
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}) {
  const inputRate = readCostPerMillion({
    provider: args.provider,
    model: args.model,
    direction: "input",
  });
  const outputRate = readCostPerMillion({
    provider: args.provider,
    model: args.model,
    direction: "output",
  });
  if (inputRate === undefined || outputRate === undefined) {
    return undefined;
  }
  const inputCost = ((args.inputTokens || 0) / 1_000_000) * inputRate;
  const outputCost = ((args.outputTokens || 0) / 1_000_000) * outputRate;
  return Number((inputCost + outputCost).toFixed(8));
}

function enrichAttemptWithUsage(args: {
  provider: "azure" | "codex" | "heuristic";
  model: string;
  usageSource: "provider" | "estimated";
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}) {
  const usage = normalizeTokenUsage({
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    totalTokens: args.totalTokens,
  });
  if (!usage) {
    return {};
  }
  const estimatedCostUsd = estimateCostUsd({
    provider: args.provider,
    model: args.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    usageSource: args.usageSource,
    ...(estimatedCostUsd === undefined
      ? {}
      : {
          estimatedCostUsd,
          costCurrency: "USD" as const,
          pricingVersion: (process.env.SLM_AI_PRICING_VERSION || "").trim() || "env-config",
        }),
  };
}

function estimateTextTokens(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return Math.max(1, Math.round(trimmed.length / 4));
}

function normalizeRuntimeInt(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.round(Math.max(min, Math.min(value as number, max)));
}

function resolveModelToolConfig(runtime?: RuntimeAiTuning) {
  return {
    maxToolRounds: normalizeRuntimeInt(
      runtime?.maxToolRounds,
      parseBoundedNumber(process.env.SLM_AI_TOOL_MAX_ROUNDS, DEFAULT_MODEL_TOOL_MAX_ROUNDS, 0, MODEL_TOOL_MAX_ROUNDS_CAP),
      0,
      MODEL_TOOL_MAX_ROUNDS_CAP,
    ),
    maxToolCallsPerRound: normalizeRuntimeInt(
      runtime?.maxToolCallsPerRound,
      parseBoundedNumber(
        process.env.SLM_AI_TOOL_MAX_CALLS_PER_ROUND,
        DEFAULT_MODEL_TOOL_MAX_CALLS_PER_ROUND,
        1,
        MODEL_TOOL_MAX_CALLS_PER_ROUND_CAP,
      ),
      1,
      MODEL_TOOL_MAX_CALLS_PER_ROUND_CAP,
    ),
    toolTimeoutMs: normalizeRuntimeInt(
      runtime?.toolTimeoutMs,
      parseBoundedNumber(
        process.env.SLM_AI_TOOL_TIMEOUT_MS,
        DEFAULT_MODEL_TOOL_TIMEOUT_MS,
        250,
        MODEL_TOOL_TIMEOUT_MS_CAP,
      ),
      250,
      MODEL_TOOL_TIMEOUT_MS_CAP,
    ),
  };
}

function buildResponseToolDefinition() {
  return [
    {
      type: "function",
      name: MODEL_TOOL_ROUTER_NAME,
      description:
        "Plan and execute internal context/retrieval tools for this chat task, then return structured findings and summaries.",
      strict: true,
      parameters: MODEL_TOOL_ROUTER_SCHEMA,
    },
  ];
}

function buildChatToolDefinition() {
  return [
    {
      type: "function",
      function: {
        name: MODEL_TOOL_ROUTER_NAME,
        description:
          "Plan and execute internal context/retrieval tools for this chat task, then return structured findings and summaries.",
        strict: true,
        parameters: MODEL_TOOL_ROUTER_SCHEMA,
      },
    },
  ];
}

function compactToolOutputPreview(value: unknown, maxChars = 260) {
  const encoded = JSON.stringify(value ?? null);
  if (encoded.length <= maxChars) {
    return encoded;
  }
  return `${encoded.slice(0, Math.max(0, maxChars - 3))}...`;
}

function sanitizeToolOutputForModel(value: unknown) {
  const encoded = JSON.stringify(value ?? null);
  if (encoded.length <= 12_000) {
    return value;
  }
  return {
    truncated: true,
    outputSize: encoded.length,
    preview: encoded.slice(0, 1_200),
  };
}

function safeParseJsonObject(value: unknown) {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function parseToolRouterPlanInput(raw: unknown): { parsed?: ToolRouterPlanInput; error?: string } {
  const payload = safeParseJsonObject(raw);
  if (!payload) {
    return {
      error: "Tool arguments must be a JSON object.",
    };
  }

  const allowedKeys = new Set([
    "task",
    "candidateReply",
    "includeExtraction",
    "maxResults",
    "maxToolsPerRun",
    "threadId",
    "contactJid",
  ]);
  const unknownKeys = Object.keys(payload).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    return {
      error: `Unsupported argument keys: ${unknownKeys.join(", ")}`,
    };
  }

  const task = typeof payload.task === "string" ? payload.task.trim() : "";
  if (!task) {
    return {
      error: "Tool argument 'task' is required.",
    };
  }

  const candidateReply = typeof payload.candidateReply === "string" ? payload.candidateReply.trim().slice(0, 600) : undefined;
  const includeExtraction = Boolean(payload.includeExtraction);
  const maxResultsRaw = payload.maxResults;
  if (maxResultsRaw !== undefined && (!Number.isFinite(Number(maxResultsRaw)) || Number(maxResultsRaw) > MODEL_TOOL_MAX_RESULTS_CAP)) {
    return {
      error: `maxResults must be <= ${MODEL_TOOL_MAX_RESULTS_CAP}.`,
    };
  }
  const maxToolsPerRunRaw = payload.maxToolsPerRun;
  if (
    maxToolsPerRunRaw !== undefined &&
    (!Number.isFinite(Number(maxToolsPerRunRaw)) || Number(maxToolsPerRunRaw) > MODEL_TOOL_MAX_TOOLS_PER_RUN_CAP)
  ) {
    return {
      error: `maxToolsPerRun must be <= ${MODEL_TOOL_MAX_TOOLS_PER_RUN_CAP}.`,
    };
  }

  const maxResults =
    maxResultsRaw === undefined ? undefined : Math.round(Math.max(1, Math.min(Number(maxResultsRaw), MODEL_TOOL_MAX_RESULTS_CAP)));
  const maxToolsPerRun =
    maxToolsPerRunRaw === undefined
      ? undefined
      : Math.round(Math.max(1, Math.min(Number(maxToolsPerRunRaw), MODEL_TOOL_MAX_TOOLS_PER_RUN_CAP)));
  const threadId = typeof payload.threadId === "string" ? payload.threadId.trim() : undefined;
  const contactJid = typeof payload.contactJid === "string" ? payload.contactJid.trim() : undefined;

  return {
    parsed: {
      task: task.slice(0, 320),
      candidateReply: candidateReply || undefined,
      includeExtraction,
      maxResults,
      maxToolsPerRun,
      threadId: threadId || undefined,
      contactJid: contactJid || undefined,
    },
  };
}

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
      promise
        .then((value) => resolve(value))
        .catch((error) => reject(error));
    });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

type ParsedResponseToolCall = {
  callId: string;
  name: string;
  arguments: unknown;
};

function extractResponseFunctionCalls(payload: unknown): ParsedResponseToolCall[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) {
    return [];
  }

  return output
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const type = (item as { type?: unknown }).type;
      if (type !== "function_call") {
        return null;
      }
      const callIdRaw = (item as { call_id?: unknown; id?: unknown }).call_id ?? (item as { id?: unknown }).id;
      const callId = typeof callIdRaw === "string" && callIdRaw.trim() ? callIdRaw.trim() : `response_call_${index}`;
      const nameRaw = (item as { name?: unknown }).name;
      const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
      const argumentsRaw = (item as { arguments?: unknown }).arguments;
      return {
        callId,
        name,
        arguments: argumentsRaw,
      } satisfies ParsedResponseToolCall;
    })
    .filter((item): item is ParsedResponseToolCall => Boolean(item));
}

function extractChatToolCalls(payload: unknown): ParsedResponseToolCall[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return [];
  }
  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    return [];
  }
  const message = (firstChoice as { message?: unknown }).message;
  if (!message || typeof message !== "object") {
    return [];
  }
  const toolCalls = (message as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const idRaw = (item as { id?: unknown }).id;
      const callId = typeof idRaw === "string" && idRaw.trim() ? idRaw.trim() : `chat_tool_call_${index}`;
      const fn = (item as { function?: unknown }).function;
      if (!fn || typeof fn !== "object") {
        return null;
      }
      const nameRaw = (fn as { name?: unknown }).name;
      const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
      const argumentsRaw = (fn as { arguments?: unknown }).arguments;
      return {
        callId,
        name,
        arguments: argumentsRaw,
      } satisfies ParsedResponseToolCall;
    })
    .filter((item): item is ParsedResponseToolCall => Boolean(item));
}

async function executeModelToolRouterCall(args: {
  rawArguments: unknown;
  round: number;
  callIndex: number;
  toolTimeoutMs: number;
  context: ModelToolContext;
}): Promise<{
  outputPayload: Record<string, unknown>;
  call: ContextToolCall;
}> {
  const startedAt = Date.now();
  const parsed = parseToolRouterPlanInput(args.rawArguments);
  if (!parsed.parsed) {
    const latencyMs = Date.now() - startedAt;
    return {
      outputPayload: {
        status: "error",
        errorCode: "validation",
        errorMessage: parsed.error || "Invalid tool arguments.",
      },
      call: {
        name: "model_tool_router_plan",
        latencyMs,
        input: {
          round: args.round,
          callIndex: args.callIndex,
          parseOk: false,
          rawArgumentsType: typeof args.rawArguments,
        },
        output: {
          status: "error",
          errorCode: "validation",
          errorMessage: parsed.error || "Invalid tool arguments.",
        },
      },
    };
  }

  if (parsed.parsed.threadId && args.context.threadId && parsed.parsed.threadId !== args.context.threadId) {
    const latencyMs = Date.now() - startedAt;
    return {
      outputPayload: {
        status: "error",
        errorCode: "scope_mismatch",
        errorMessage: "threadId mismatch rejected by server scope.",
      },
      call: {
        name: "model_tool_router_plan",
        latencyMs,
        input: {
          round: args.round,
          callIndex: args.callIndex,
          parseOk: true,
          task: parsed.parsed.task,
        },
        output: {
          status: "error",
          errorCode: "scope_mismatch",
          errorMessage: "threadId mismatch rejected by server scope.",
        },
      },
    };
  }

  if (parsed.parsed.contactJid && args.context.contactJid && parsed.parsed.contactJid !== args.context.contactJid) {
    const latencyMs = Date.now() - startedAt;
    return {
      outputPayload: {
        status: "error",
        errorCode: "scope_mismatch",
        errorMessage: "contactJid mismatch rejected by server scope.",
      },
      call: {
        name: "model_tool_router_plan",
        latencyMs,
        input: {
          round: args.round,
          callIndex: args.callIndex,
          parseOk: true,
          task: parsed.parsed.task,
        },
        output: {
          status: "error",
          errorCode: "scope_mismatch",
          errorMessage: "contactJid mismatch rejected by server scope.",
        },
      },
    };
  }

  try {
    const execution = await runWithTimeout(
      args.context.executeToolRouterPlan({
        task: parsed.parsed.task,
        candidateReply: parsed.parsed.candidateReply,
        includeExtraction: Boolean(parsed.parsed.includeExtraction),
        maxResults: parsed.parsed.maxResults ?? 8,
        maxToolsPerRun: parsed.parsed.maxToolsPerRun ?? 6,
        toolTimeoutMs: args.toolTimeoutMs,
      }),
      args.toolTimeoutMs,
    );
    const latencyMs = Date.now() - startedAt;
    const outputPayload = {
      status: execution.status,
      ...(execution.errorCode ? { errorCode: execution.errorCode } : {}),
      ...(execution.errorMessage ? { errorMessage: execution.errorMessage } : {}),
      output: sanitizeToolOutputForModel(execution.output ?? null),
    };
    return {
      outputPayload,
      call: {
        name: "model_tool_router_plan",
        latencyMs,
        input: {
          round: args.round,
          callIndex: args.callIndex,
          parseOk: true,
          task: parsed.parsed.task,
          includeExtraction: Boolean(parsed.parsed.includeExtraction),
          maxResults: parsed.parsed.maxResults ?? 8,
          maxToolsPerRun: parsed.parsed.maxToolsPerRun ?? 6,
        },
        output: {
          status: execution.status,
          ...(execution.errorCode ? { errorCode: execution.errorCode } : {}),
          ...(execution.errorMessage ? { errorMessage: execution.errorMessage } : {}),
          preview: compactToolOutputPreview(execution.output),
        },
      },
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message = toErrorMessage(error);
    return {
      outputPayload: {
        status: "timeout",
        errorCode: "timeout",
        errorMessage: message,
      },
      call: {
        name: "model_tool_router_plan",
        latencyMs,
        input: {
          round: args.round,
          callIndex: args.callIndex,
          parseOk: true,
          task: parsed.parsed.task,
        },
        output: {
          status: "timeout",
          errorCode: "timeout",
          errorMessage: message,
        },
      },
    };
  }
}

async function runAzure(
  prompt: string,
  inboundText: string,
  historyLines: string[],
  runtime?: RuntimeAiTuning,
  modelToolContext?: ModelToolContext,
): Promise<AttemptOutcome> {
  const cfg = getAzureConfig(runtime);
  const attempts: AiAttempt[] = [];
  const toolCalls: ContextToolCall[] = [];
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
    return { attempts, toolCalls };
  }

  const startAll = Date.now();
  const toolConfig = resolveModelToolConfig(runtime);
  const toolEnabled = Boolean(modelToolContext) && toolConfig.maxToolRounds > 0;
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
      let raw: unknown = null;
      let tokenUsage: ReturnType<typeof extractTokenUsageFromProviderPayload> = null;
      if (!toolEnabled || !modelToolContext) {
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

        raw = await response.json();
        tokenUsage = extractTokenUsageFromProviderPayload(raw);
      } else {
        let previousResponseId: string | undefined;
        let nextInput: unknown = prompt;
        const tools = buildResponseToolDefinition();
        for (let round = 0; round <= toolConfig.maxToolRounds; round += 1) {
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
              input: nextInput,
              ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
              temperature: cfg.temperature,
              max_output_tokens: cfg.maxOutputTokens,
              tools,
              tool_choice: "auto",
              parallel_tool_calls: true,
            }),
          });

          if (!response.ok) {
            const text = await response.text();
            throw new Error(`Azure Responses failed (${response.status}): ${text.slice(0, 300)}`);
          }

          raw = await response.json();
          tokenUsage = extractTokenUsageFromProviderPayload(raw);
          const responseId = (raw as { id?: unknown })?.id;
          if (typeof responseId === "string" && responseId.trim()) {
            previousResponseId = responseId;
          }

          const functionCalls = extractResponseFunctionCalls(raw);
          if (functionCalls.length === 0) {
            break;
          }
          if (round >= toolConfig.maxToolRounds) {
            throw new Error(`Tool-calling rounds exceeded maxToolRounds=${toolConfig.maxToolRounds}.`);
          }

          const selectedCalls = functionCalls.slice(0, toolConfig.maxToolCallsPerRound);
          const skippedCalls = functionCalls.slice(toolConfig.maxToolCallsPerRound);
          const executed = await Promise.all(
            selectedCalls.map(async (call, index) => {
              if (call.name !== MODEL_TOOL_ROUTER_NAME) {
                const latencyMs = 0;
                return {
                  callId: call.callId,
                  outputPayload: {
                    status: "error",
                    errorCode: "unsupported_tool",
                    errorMessage: `Unsupported tool ${call.name}.`,
                  },
                  callTelemetry: {
                    name: "model_tool_router_plan" as const,
                    latencyMs,
                    input: {
                      round: round + 1,
                      callIndex: index,
                      requestedTool: call.name,
                    },
                    output: {
                      status: "error",
                      errorCode: "unsupported_tool",
                      errorMessage: `Unsupported tool ${call.name}.`,
                    },
                  },
                };
              }
              const execution = await executeModelToolRouterCall({
                rawArguments: call.arguments,
                round: round + 1,
                callIndex: index,
                toolTimeoutMs: toolConfig.toolTimeoutMs,
                context: modelToolContext,
              });
              return {
                callId: call.callId,
                outputPayload: execution.outputPayload,
                callTelemetry: execution.call,
              };
            }),
          );

          for (const skipped of skippedCalls) {
            executed.push({
              callId: skipped.callId,
              outputPayload: {
                status: "error",
                errorCode: "max_tool_calls_per_round_exceeded",
                errorMessage: `Skipped because tool call count exceeded ${toolConfig.maxToolCallsPerRound} in a single round.`,
              },
              callTelemetry: {
                name: "model_tool_router_plan" as const,
                latencyMs: 0,
                input: {
                  round: round + 1,
                  requestedTool: skipped.name,
                },
                output: {
                  status: "error",
                  errorCode: "max_tool_calls_per_round_exceeded",
                },
              },
            });
          }

          toolCalls.push(...executed.map((item) => item.callTelemetry));
          nextInput = executed.map((item) => ({
            type: "function_call_output",
            call_id: item.callId,
            output: JSON.stringify(item.outputPayload),
          }));
        }
      }

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
        ...enrichAttemptWithUsage({
          provider: "azure",
          model: cfg.model,
          usageSource: "provider",
          ...(tokenUsage || {}),
        }),
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
        toolCalls,
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
      return { attempts, toolCalls };
    }
  }

  if (toolEnabled && modelToolContext) {
    const chatStart = Date.now();
    const chatEndpoint = buildAzureChatCompletionsEndpoint(cfg.endpoint);
    const chatMessages: Array<Record<string, unknown>> = [...messages];
    let lastData: unknown = null;
    let tokenUsage: ReturnType<typeof extractTokenUsageFromProviderPayload> = null;

    try {
      const tools = buildChatToolDefinition();
      for (let round = 0; round <= toolConfig.maxToolRounds; round += 1) {
        const response = await fetch(chatEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-key": cfg.apiKey,
            Authorization: `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify({
            model: cfg.model,
            messages: chatMessages,
            max_tokens: cfg.maxOutputTokens,
            temperature: cfg.temperature,
            tools,
            tool_choice: "auto",
            parallel_tool_calls: true,
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Azure Chat Completions failed (${response.status}): ${text.slice(0, 300)}`);
        }

        const data = await response.json();
        lastData = data;
        tokenUsage = extractTokenUsageFromProviderPayload(data);
        const toolCallsForRound = extractChatToolCalls(data);
        if (toolCallsForRound.length === 0) {
          break;
        }
        if (round >= toolConfig.maxToolRounds) {
          throw new Error(`Tool-calling rounds exceeded maxToolRounds=${toolConfig.maxToolRounds}.`);
        }

        const firstChoiceMessage = ((data as { choices?: Array<{ message?: unknown }> }).choices || [])[0]?.message;
        if (firstChoiceMessage && typeof firstChoiceMessage === "object") {
          const assistantMessage = firstChoiceMessage as {
            role?: unknown;
            content?: unknown;
            tool_calls?: unknown;
          };
          chatMessages.push({
            role: typeof assistantMessage.role === "string" ? assistantMessage.role : "assistant",
            ...(assistantMessage.content !== undefined ? { content: assistantMessage.content } : { content: "" }),
            ...(Array.isArray(assistantMessage.tool_calls) ? { tool_calls: assistantMessage.tool_calls } : {}),
          });
        }

        const selectedCalls = toolCallsForRound.slice(0, toolConfig.maxToolCallsPerRound);
        const skippedCalls = toolCallsForRound.slice(toolConfig.maxToolCallsPerRound);
        const executed = await Promise.all(
          selectedCalls.map(async (call, index) => {
            if (call.name !== MODEL_TOOL_ROUTER_NAME) {
              return {
                callId: call.callId,
                outputPayload: {
                  status: "error",
                  errorCode: "unsupported_tool",
                  errorMessage: `Unsupported tool ${call.name}.`,
                },
                callTelemetry: {
                  name: "model_tool_router_plan" as const,
                  latencyMs: 0,
                  input: {
                    round: round + 1,
                    callIndex: index,
                    requestedTool: call.name,
                  },
                  output: {
                    status: "error",
                    errorCode: "unsupported_tool",
                    errorMessage: `Unsupported tool ${call.name}.`,
                  },
                },
              };
            }
            const execution = await executeModelToolRouterCall({
              rawArguments: call.arguments,
              round: round + 1,
              callIndex: index,
              toolTimeoutMs: toolConfig.toolTimeoutMs,
              context: modelToolContext,
            });
            return {
              callId: call.callId,
              outputPayload: execution.outputPayload,
              callTelemetry: execution.call,
            };
          }),
        );
        for (const skipped of skippedCalls) {
          executed.push({
            callId: skipped.callId,
            outputPayload: {
              status: "error",
              errorCode: "max_tool_calls_per_round_exceeded",
              errorMessage: `Skipped because tool call count exceeded ${toolConfig.maxToolCallsPerRound} in a single round.`,
            },
            callTelemetry: {
              name: "model_tool_router_plan" as const,
              latencyMs: 0,
              input: {
                round: round + 1,
                requestedTool: skipped.name,
              },
              output: {
                status: "error",
                errorCode: "max_tool_calls_per_round_exceeded",
              },
            },
          });
        }

        toolCalls.push(...executed.map((item) => item.callTelemetry));
        for (const executedCall of executed) {
          chatMessages.push({
            role: "tool",
            tool_call_id: executedCall.callId,
            name: MODEL_TOOL_ROUTER_NAME,
            content: JSON.stringify(executedCall.outputPayload),
          });
        }
      }

      const cleaned = sanitizeReplyText(extractAzureChatCompletionText(lastData), runtime?.maxReplyChars);
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
        latencyMs: Date.now() - chatStart,
        ...enrichAttemptWithUsage({
          provider: "azure",
          model: cfg.model,
          usageSource: "provider",
          ...(tokenUsage || {}),
        }),
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
        toolCalls,
      };
    } catch (error) {
      attempts.push({
        provider: "azure",
        stage: "azure_sdk",
        model: cfg.model,
        status: "error",
        latencyMs: Date.now() - chatStart,
        error: toErrorMessage(error),
      });
      return { attempts, toolCalls };
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

    const tokenUsage = extractTokenUsageFromProviderPayload(response.body);
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
      ...enrichAttemptWithUsage({
        provider: "azure",
        model: cfg.model,
        usageSource: "provider",
        ...(tokenUsage || {}),
      }),
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
      toolCalls,
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

    const data = await response.json();
    const tokenUsage = extractTokenUsageFromProviderPayload(data);
    const parsedData = data as {
      choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
    };

    const content = parsedData.choices?.[0]?.message?.content;
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
      ...enrichAttemptWithUsage({
        provider: "azure",
        model: cfg.model,
        usageSource: "provider",
        ...(tokenUsage || {}),
      }),
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
      toolCalls,
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
    return { attempts, toolCalls };
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
      timeout: Math.round(Math.max(20_000, Math.min(runtime?.codexTimeoutMs ?? QUALITY_FIRST_CODEX_TIMEOUT_MS, 300_000))),
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
          ...enrichAttemptWithUsage({
            provider: "codex",
            model,
            usageSource: "estimated",
            inputTokens: estimateTextTokens(prompt),
            outputTokens: estimateTextTokens(text),
          }),
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
  const allToolCalls: ContextToolCall[] = [];
  const maxReprompts = Math.round(Math.max(0, Math.min(args.maxReprompts ?? BLOCKED_REFUSAL_REPROMPT_LIMIT, 4)));
  let prompt = args.basePrompt;

  for (let retry = 0; retry <= maxReprompts; retry += 1) {
    const outcome = await args.run(prompt);
    allAttempts.push(...outcome.attempts);
    allToolCalls.push(...(outcome.toolCalls || []));
    if (outcome.result) {
      return {
        result: outcome.result,
        attempts: allAttempts,
        promptUsed: prompt,
        toolCalls: allToolCalls,
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
    toolCalls: allToolCalls,
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
  const humorEligibilityForGate = evaluateHumorEligibility({
    inboundText: args.inboundText,
    historyLines: args.historyLines,
    steeringMode: detectConversationSteeringMode({
      inboundText: args.inboundText,
      historyLines: args.historyLines,
    }),
    soulModeEnabled: args.runtime?.soulModeEnabled ?? true,
    funnyKeywords: (args.runtime?.funnyStatusKeywords || DEFAULT_FUNNY_STATUS_KEYWORDS).slice(0, 30),
    funnyEmojis: (args.runtime?.funnyStatusEmojis || DEFAULT_FUNNY_STATUS_EMOJIS).slice(0, 30),
  });
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

  const copyRisk = evaluateCopyRisk({
    replyText: selected.text,
    inboundText: args.inboundText,
    historyLines: args.historyLines,
  });
  if (copyRisk.blocked) {
    const copyRiskRewrite = await rewriteCopyRiskReplyOnce({
      candidateText: selected.text,
      inboundText: args.inboundText,
      historyLines: args.historyLines,
      basePrompt: args.basePrompt,
      runtime: args.runtime,
      copyRisk,
    });
    selectedAttempts = [...selectedAttempts, ...copyRiskRewrite.attempts];
    if (!copyRiskRewrite.result) {
      return manualReviewResult(`Copy-risk rewrite failed: ${copyRisk.reason}`);
    }

    selected = copyRiskRewrite.result;
    selectedEvaluation = evaluateReplyQuality({
      replyText: copyRiskRewrite.result.text,
      inboundText: args.inboundText,
      historyLines: args.historyLines,
      pack: args.activePersonaPack,
      threshold,
    });
    qualityRewriteApplied = qualityRewriteApplied || normalizeOutboundText(args.candidate.text) !== normalizeOutboundText(selected.text);

    const rewrittenCopyRisk = evaluateCopyRisk({
      replyText: selected.text,
      inboundText: args.inboundText,
      historyLines: args.historyLines,
    });
    if (rewrittenCopyRisk.blocked) {
      return manualReviewResult(`Copy-risk rewrite still violated guardrail: ${rewrittenCopyRisk.reason}`);
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
    const jokeGuardrail = evaluateJokeGuardrail(selected.text, args.historyLines, {
      inboundText: args.inboundText,
      funnyKeywords: args.runtime?.funnyStatusKeywords,
      funnyEmojis: args.runtime?.funnyStatusEmojis,
    });
    const humorEligibilityBlocked = !humorEligibilityForGate.allowHumor;
    if (humorEligibilityBlocked || jokeGuardrail.blocked) {
      if (!humorEligibilityBlocked && jokeGuardrail.code !== "recent_joke_chain" && jokeGuardrail.code !== "unsupported_context") {
        return manualReviewResult(jokeGuardrail.reason);
      }

      const guardrailInstruction =
        humorEligibilityBlocked
          ? buildHumorEligibilityRewriteInstruction(humorEligibilityForGate)
          : jokeGuardrail.code === "unsupported_context"
          ? "Inbound context is not strongly playful enough to justify humor. Rewrite into a direct, non-joke reply."
          : `The last ${JOKE_CHAIN_OUTBOUND_COOLDOWN} outbound replies already include humor. Rewrite this into a direct, non-joke response.`;
      const antiStretchRewrite = await rewriteJokeChainReplyOnce({
        candidateText: selected.text,
        inboundText: args.inboundText,
        historyLines: args.historyLines,
        basePrompt: args.basePrompt,
        runtime: args.runtime,
        guardrailInstruction,
      });
      selectedAttempts = [...selectedAttempts, ...antiStretchRewrite.attempts];
      if (!antiStretchRewrite.result) {
        const reason = humorEligibilityBlocked ? "Humor eligibility gate blocked humor." : jokeGuardrail.reason;
        return manualReviewResult(`${reason} Auto-rewrite failed.`);
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
        return manualReviewResult("Humor-guardrail rewrite produced a humor candidate but AI humor judge was unavailable.");
      }

      if (rewrittenHumorEvaluation.judgment?.isJokeAttempt && !rewrittenHumorEvaluation.judgment.isFunny) {
        return manualReviewResult(
          `Humor-guardrail rewrite was still humor but judged not funny (${Math.round(rewrittenHumorEvaluation.judgment.confidence * 100)}%): ${rewrittenHumorEvaluation.judgment.reason}`,
        );
      }

      if (humorEligibilityBlocked && rewrittenHumorEvaluation.judgment?.isJokeAttempt) {
        return manualReviewResult("Humor-eligibility rewrite still produced humor while humor is blocked for this context.");
      }

      if (rewrittenHumorEvaluation.judgment?.isJokeAttempt && rewrittenHumorEvaluation.judgment.isFunny) {
        const rewrittenGuardrail = evaluateJokeGuardrail(selected.text, args.historyLines, {
          inboundText: args.inboundText,
          funnyKeywords: args.runtime?.funnyStatusKeywords,
          funnyEmojis: args.runtime?.funnyStatusEmojis,
        });
        if (rewrittenGuardrail.blocked) {
          return manualReviewResult(`Humor-guardrail rewrite still violated guardrail: ${rewrittenGuardrail.reason}`);
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

type AckRoutingResult = {
  channel?: AckRoutingChannel;
  reason?: string;
  provider?: "azure" | "codex";
  model?: string;
  latencyMs: number;
  attempts: AiAttempt[];
};

function normalizeAckRoutingChannel(value: string): AckRoutingChannel | null {
  const normalized = value.trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (!normalized) {
    return null;
  }
  if (normalized === "reaction_only" || normalized === "reaction") {
    return "reaction_only";
  }
  if (normalized === "reaction_plus_text" || normalized === "reaction_text" || normalized === "react_plus_text") {
    return "reaction_plus_text";
  }
  if (normalized === "text" || normalized === "text_only") {
    return "text";
  }
  return null;
}

function parseAckRoutingOutput(raw: string): { channel?: AckRoutingChannel; reason?: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    const jsonText = trimmed.slice(objectStart, objectEnd + 1);
    try {
      const parsed = JSON.parse(jsonText) as {
        channel?: unknown;
        reason?: unknown;
      };
      const channel = typeof parsed.channel === "string" ? normalizeAckRoutingChannel(parsed.channel) : null;
      if (!channel) {
        return null;
      }
      const reason =
        typeof parsed.reason === "string" && parsed.reason.trim()
          ? normalizeOutboundText(parsed.reason).slice(0, 120)
          : undefined;
      return { channel, reason };
    } catch {
      return null;
    }
  }

  const channel =
    normalizeAckRoutingChannel(trimmed) ||
    (/\breaction[\s_+-]*plus[\s_+-]*text\b/i.test(trimmed)
      ? "reaction_plus_text"
      : /\breaction[\s_+-]*only\b/i.test(trimmed)
        ? "reaction_only"
        : /\btext\b/i.test(trimmed)
          ? "text"
          : null);
  if (!channel) {
    return null;
  }
  return { channel };
}

function buildAckRoutingPrompt(args: {
  inboundText: string;
  historyLines: string[];
}) {
  const recentHistory = args.historyLines
    .slice(-6)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return [
    "You are routing a short WhatsApp inbound to an outbound channel.",
    "Choose exactly one channel:",
    "- reaction_only: pure acknowledgment/closure where an emoji reaction is enough.",
    "- reaction_plus_text: acknowledgment where reaction helps and one tiny text line adds value.",
    "- text: any request/question/ambiguity/risk, or when unsure.",
    "Bias toward text when uncertain.",
    "Output strict JSON only with keys channel and reason.",
    'Example: {"channel":"reaction_only","reason":"pure acknowledgment"}',
    recentHistory ? `Recent chat:\n${recentHistory}` : "",
    `Latest inbound: ${args.inboundText}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function runAckRouterWithAzure(args: {
  prompt: string;
  runtime?: RuntimeAiTuning;
}): Promise<AckRoutingResult> {
  const cfg = getAzureConfig(args.runtime);
  if (!cfg.endpoint || !cfg.apiKey) {
    return {
      latencyMs: 0,
      attempts: [
        {
          provider: "azure",
          stage: "ack_router_azure",
          model: cfg.model,
          status: "error",
          latencyMs: 0,
          error: "Azure AI endpoint/key missing for ack router.",
        },
      ],
    };
  }

  const start = Date.now();
  try {
    let rawText = "";
    let tokenUsage: ReturnType<typeof extractTokenUsageFromProviderPayload> = null;
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
          instructions: "You are a strict JSON classifier.",
          input: args.prompt,
          temperature: 0,
          max_output_tokens: 80,
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Azure ack router failed (${response.status}): ${text.slice(0, 240)}`);
      }
      const payload = await response.json();
      tokenUsage = extractTokenUsageFromProviderPayload(payload);
      rawText = extractAzureResponsesText(payload);
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
              content: "You are a strict JSON classifier.",
            },
            {
              role: "user",
              content: args.prompt,
            },
          ],
          temperature: 0,
          max_tokens: 80,
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Azure ack router failed (${response.status}): ${text.slice(0, 240)}`);
      }
      const payload = await response.json();
      tokenUsage = extractTokenUsageFromProviderPayload(payload);
      rawText = extractAzureChatCompletionText(payload);
    }

    const parsed = parseAckRoutingOutput(rawText);
    if (!parsed?.channel) {
      throw new Error(`Unable to parse ack router output: ${rawText.slice(0, 200)}`);
    }

    const latencyMs = Date.now() - start;
    return {
      channel: parsed.channel,
      reason: parsed.reason,
      provider: "azure",
      model: cfg.model,
      latencyMs,
      attempts: [
        {
          provider: "azure",
          stage: "ack_router_azure",
          model: cfg.model,
          status: "success",
          latencyMs,
          ...enrichAttemptWithUsage({
            provider: "azure",
            model: cfg.model,
            usageSource: "provider",
            ...(tokenUsage || {}),
          }),
        },
      ],
    };
  } catch (error) {
    return {
      latencyMs: Date.now() - start,
      attempts: [
        {
          provider: "azure",
          stage: "ack_router_azure",
          model: cfg.model,
          status: "error",
          latencyMs: Date.now() - start,
          error: toErrorMessage(error),
        },
      ],
    };
  }
}

async function runAckRouterWithCodex(args: {
  prompt: string;
  runtime?: RuntimeAiTuning;
}): Promise<AckRoutingResult> {
  const codexPath = process.env.CODEX_CLI_PATH || "codex";
  const model = process.env.CODEX_FALLBACK_MODEL || "gpt-5.2";
  const outFile = join(tmpdir(), `slm-ack-router-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
  const start = Date.now();
  try {
    await execFileAsync(codexPath, ["exec", "--model", model, "--output-last-message", outFile, args.prompt], {
      timeout: Math.round(Math.max(20_000, Math.min(args.runtime?.codexTimeoutMs ?? QUALITY_FIRST_CODEX_TIMEOUT_MS, 300_000))),
      maxBuffer: 1024 * 1024,
    });
    const raw = await fs.readFile(outFile, "utf8");
    await fs.unlink(outFile).catch(() => undefined);

    const parsed = parseAckRoutingOutput(raw);
    if (!parsed?.channel) {
      throw new Error(`Unable to parse codex ack router output: ${raw.slice(0, 200)}`);
    }

    const latencyMs = Date.now() - start;
    return {
      channel: parsed.channel,
      reason: parsed.reason,
      provider: "codex",
      model,
      latencyMs,
      attempts: [
        {
          provider: "codex",
          stage: "ack_router_codex",
          model,
          status: "success",
          latencyMs,
          ...enrichAttemptWithUsage({
            provider: "codex",
            model,
            usageSource: "estimated",
            inputTokens: estimateTextTokens(args.prompt),
            outputTokens: estimateTextTokens(raw),
          }),
        },
      ],
    };
  } catch (error) {
    await fs.unlink(outFile).catch(() => undefined);
    return {
      latencyMs: Date.now() - start,
      attempts: [
        {
          provider: "codex",
          stage: "ack_router_codex",
          model,
          status: "error",
          latencyMs: Date.now() - start,
          error: toErrorMessage(error),
        },
      ],
    };
  }
}

export async function routeAckResponseChannel(args: {
  inboundText: string;
  historyLines: string[];
  runtime?: RuntimeAiTuning;
}): Promise<AckRoutingResult> {
  const prompt = buildAckRoutingPrompt({
    inboundText: args.inboundText,
    historyLines: args.historyLines,
  });
  const attempts: AiAttempt[] = [];

  const azure = await runAckRouterWithAzure({
    prompt,
    runtime: args.runtime,
  });
  attempts.push(...azure.attempts);
  if (azure.channel) {
    return {
      ...azure,
      attempts,
    };
  }

  if (resolveFallbackMode(args.runtime) === "all") {
    const codex = await runAckRouterWithCodex({
      prompt,
      runtime: args.runtime,
    });
    attempts.push(...codex.attempts);
    if (codex.channel) {
      return {
        ...codex,
        attempts,
      };
    }
  }

  return {
    latencyMs: attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0),
    attempts,
  };
}

export async function generateReplyWithFallback(args: {
  inboundText: string;
  historyLines: string[];
  historySearchOverride?: HistorySearchOverride;
  contactFacts?: ContactMemoryFactContext[];
  styleHints: string[];
  styleProfile?: StyleProfileContext;
  personality?: PersonalityContext;
  grounding?: GroundingContext;
  runtime?: RuntimeAiTuning;
  modelToolContext?: ModelToolContext;
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
  const deterministicBypassModes = resolveDeterministicBypassModes(args.runtime);
  const shouldUseHeuristicOnly = steeringMode !== "none" && deterministicBypassModes.has(steeringMode);
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
    run: (prompt) => runAzure(prompt, args.inboundText, args.historyLines, args.runtime, args.modelToolContext),
  });
  const combinedContextToolCalls = [...builtPrompt.contextToolCalls, ...(azureOutcome.toolCalls || [])];
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
      contextToolCalls: combinedContextToolCalls,
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
      contextToolCalls: combinedContextToolCalls,
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
      contextToolCalls: combinedContextToolCalls,
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
    contextToolCalls: combinedContextToolCalls,
    contextWindow: builtPrompt.contextWindow,
  });
}

export function estimateDelayAndTyping(text: string, runtime?: RuntimeAiTuning) {
  const len = Math.max(text.length, 10);
  const requestedMinDelay = Number(runtime?.delayMinMs ?? process.env.SLM_DELAY_MIN_MS ?? QUALITY_FIRST_DELAY_MIN_MS);
  const requestedMaxDelay = Number(runtime?.delayMaxMs ?? process.env.SLM_DELAY_MAX_MS ?? QUALITY_FIRST_DELAY_MAX_MS);
  const requestedMinTyping = Number(runtime?.typingMinMs ?? process.env.SLM_TYPING_MIN_MS ?? QUALITY_FIRST_TYPING_MIN_MS);
  const requestedMaxTyping = Number(runtime?.typingMaxMs ?? process.env.SLM_TYPING_MAX_MS ?? QUALITY_FIRST_TYPING_MAX_MS);

  const minDelay = Math.max(requestedMinDelay, QUALITY_FIRST_DELAY_MIN_MS);
  const maxDelay = Math.max(Math.max(requestedMaxDelay, QUALITY_FIRST_DELAY_MAX_MS), minDelay);
  const minTyping = Math.max(requestedMinTyping, QUALITY_FIRST_TYPING_MIN_MS);
  const maxTyping = Math.max(Math.max(requestedMaxTyping, QUALITY_FIRST_TYPING_MAX_MS), minTyping);

  const delayMs = Math.round(minDelay + (maxDelay - minDelay) * Math.min(len / 320, 1));
  const typingMs = Math.round(minTyping + (maxTyping - minTyping) * Math.min(len / 220, 1));

  return { delayMs, typingMs };
}
