import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ModelClient, { isUnexpected } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";

const execFileAsync = promisify(execFile);

type AiResult = {
  text: string;
  provider: "azure" | "codex" | "heuristic";
  model: string;
  latencyMs: number;
  guardrailBlocked: boolean;
  guardrailReason?: string;
  attempts: AiAttempt[];
};

export type AiAttempt = {
  provider: "azure" | "codex" | "heuristic";
  stage: "azure_sdk" | "azure_http" | "azure_responses" | "codex_cli" | "heuristic_guardrail" | "heuristic_fallback";
  model: string;
  status: "success" | "error";
  latencyMs: number;
  error?: string;
};

type AttemptOutcome = {
  result?: Omit<AiResult, "attempts">;
  attempts: AiAttempt[];
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
};

type GroundingContext = {
  myName?: string;
  theirName?: string;
  autoAliases?: string[];
  vibeNotes?: string;
};

type AzureApiStyle = "auto" | "chat_completions" | "responses";
type FallbackMode = "all" | "azure_only";

type RuntimeAiTuning = {
  model?: string;
  apiStyle?: AzureApiStyle;
  fallbackMode?: FallbackMode;
  systemInstruction?: string;
  replyPolicyInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  maxReplyChars?: number;
  historyLineLimit?: number;
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
  /\b(?:update|details?) (?:soon|shortly)\b/i,
  /\blet me (?:sort|check|look into|get back)\b/i,
];

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

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0.72;
  }
  return Math.max(0, Math.min(value, 1));
}

function pickVariant(input: string, options: string[]) {
  if (options.length === 0) {
    return "";
  }
  const sum = [...input].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return options[sum % options.length];
}

function heuristicReply(input: string) {
  const focus = input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !STOPWORDS.has(word))
    .slice(0, 4)
    .join(" ");

  if (/\bweird|odd|strange|robot|generic|template\b/i.test(input)) {
    return pickVariant(input, [
      "You're right, that sounded off. I'll reply properly from here.",
      "Fair call, that reply was weird. I'll keep this one human and clear.",
      "Yeah, that came out weird. Let me answer you properly now.",
    ]);
  }

  if (/\?|\b(can you|could you|when|where|what|why|how)\b/i.test(input)) {
    return pickVariant(input, [
      "Yeah, that works on my side. Give me a bit and I'll send details shortly.",
      "Yep, I can do that. Let me sort it and get back to you shortly.",
      "That works. Give me a little time and I'll send the details.",
    ]);
  }

  if (/\b(thanks|thank you)\b/i.test(input)) {
    return pickVariant(input, ["Anytime.", "Always happy to help.", "No worries at all."]);
  }

  if (/\b(sorry|apolog|my bad)\b/i.test(input)) {
    return pickVariant(input, ["All good.", "No stress, we're good.", "You're fine, no worries."]);
  }

  if (focus) {
    return pickVariant(input, [
      `I got you on ${focus}. Give me a moment and I'll send a clear reply.`,
      `Thanks for flagging ${focus}. I'll answer this properly now.`,
      `You're right about ${focus}. Let me respond clearly in a sec.`,
    ]);
  }

  return pickVariant(input, ["I got your message. Give me a moment and I'll reply clearly.", "Thanks for the nudge. I'll respond properly now."]);
}

function buildPrompt(args: {
  inboundText: string;
  historyLines: string[];
  styleHints: string[];
  styleProfile?: StyleProfileContext;
  personality?: PersonalityContext;
  grounding?: GroundingContext;
  runtime?: RuntimeAiTuning;
}) {
  const historyLineLimit = Math.round(Math.max(4, Math.min(args.runtime?.historyLineLimit ?? 14, 40)));
  const history = args.historyLines.slice(-historyLineLimit).join("\n");
  const outboundSamples = args.historyLines
    .filter((line) => line.startsWith("Me:"))
    .slice(-4)
    .map((line) => line.replace(/^Me:\s*/, "").trim())
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
  const phrases = (args.styleProfile?.commonPhrases || []).filter(Boolean).slice(0, 8).join(", ");
  const personalityIntensity = clamp01(args.personality?.intensity ?? 0.6);
  const personalityLevelInstruction =
    personalityIntensity >= 0.85
      ? "Apply the selected personality strongly and consistently."
      : personalityIntensity >= 0.6
        ? "Apply the selected personality moderately while staying natural."
        : "Apply the selected personality lightly and keep responses neutral-first.";
  const personalityLabel = args.personality?.profileName || args.personality?.profileSlug || "";
  const replyPolicyInstruction =
    args.runtime?.replyPolicyInstruction ||
    process.env.SLM_AI_REPLY_POLICY ||
    HARD_CODED_AZURE_DEFAULTS.replyPolicyInstruction ||
    "";

  return [
    "You are writing one WhatsApp reply as the account owner.",
    "Write like a real person: warm, calm, confident, and practical.",
    "Default to 1-2 short sentences unless the message clearly needs more detail.",
    "Sound conversational and specific, never stiff or corporate.",
    "Directly react to something concrete in the latest inbound message (topic, emotion, or request).",
    "Do not mention AI, policies, prompt rules, or internal reasoning.",
    "Do not overpromise. If timing is uncertain, say you'll confirm shortly.",
    "Avoid generic fillers like 'Noted', 'As an AI', 'I hope this message finds you well', or repetitive templates.",
    "Never send placeholder lines like 'Sounds good, I'll handle it and update you soon' or 'Got it, I'm on it.'",
    replyPolicyInstruction ? `Additional reply policy: ${replyPolicyInstruction}` : "",
    mimicryInstruction,
    personalityLevelInstruction,
    personalityLabel ? `Selected relationship/personality mode: ${personalityLabel}` : "",
    args.personality?.profileDescription ? `Personality description: ${args.personality.profileDescription}` : "",
    args.personality?.profilePrompt ? `Personality behavior instruction: ${args.personality.profilePrompt}` : "",
    args.personality?.customPrompt ? `Thread-specific personality note: ${args.personality.customPrompt}` : "",
    args.grounding?.myName ? `My preferred name in this thread: ${args.grounding.myName}` : "",
    args.grounding?.theirName ? `Contact preferred name in this thread: ${args.grounding.theirName}` : "",
    args.grounding?.autoAliases?.length ? `Known contact aliases: ${args.grounding.autoAliases.slice(0, 8).join(", ")}` : "",
    args.grounding?.vibeNotes ? `Conversation vibe notes: ${args.grounding.vibeNotes}` : "",
    hints ? `Style hints: ${hints}` : "",
    phrases ? `Frequent personal phrases to reuse naturally: ${phrases}` : "",
    outboundSamples ? `Recent sent-message examples: ${outboundSamples}` : "",
    history ? `Recent chat:\n${history}` : "",
    `Latest inbound message: ${args.inboundText}`,
    "Return only the final reply text.",
  ]
    .filter(Boolean)
    .join("\n\n");
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

  return normalizeOutboundText(text);
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

function isLowValueReply(text: string, inboundText?: string) {
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

async function runAzure(prompt: string, inboundText: string, runtime?: RuntimeAiTuning): Promise<AttemptOutcome> {
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

async function runCodex(prompt: string, inboundText: string, runtime?: RuntimeAiTuning): Promise<AttemptOutcome> {
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

export async function generateReplyWithFallback(args: {
  inboundText: string;
  historyLines: string[];
  styleHints: string[];
  styleProfile?: StyleProfileContext;
  personality?: PersonalityContext;
  grounding?: GroundingContext;
  runtime?: RuntimeAiTuning;
}): Promise<AiResult> {
  const blocked = HIGH_RISK_PATTERNS.find((pattern) => pattern.test(args.inboundText));
  if (blocked) {
    return {
    text: "Manual review required.",
      provider: "heuristic",
      model: "guardrail",
      latencyMs: 0,
      guardrailBlocked: true,
      guardrailReason: "High-risk topic detected in inbound message.",
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

  const prompt = buildPrompt(args);
  const attempts: AiAttempt[] = [];
  const fallbackMode = resolveFallbackMode(args.runtime);

  const azureOutcome = await runAzure(prompt, args.inboundText, args.runtime);
  attempts.push(...azureOutcome.attempts);
  if (azureOutcome.result) {
    return {
      ...azureOutcome.result,
      attempts,
    };
  }

  if (fallbackMode === "azure_only") {
    const lastAzureAttempt = azureOutcome.attempts[azureOutcome.attempts.length - 1];
    return {
      text: "Manual review required.",
      provider: "azure",
      model: lastAzureAttempt?.model || "gpt-5.4",
      latencyMs: azureOutcome.attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0),
      guardrailBlocked: true,
      guardrailReason: "Azure-only mode enabled and Azure generation failed. Manual review required.",
      attempts,
    };
  }

  const codexOutcome = await runCodex(prompt, args.inboundText, args.runtime);
  attempts.push(...codexOutcome.attempts);
  if (codexOutcome.result) {
    return {
      ...codexOutcome.result,
      attempts,
    };
  }

  attempts.push({
    provider: "heuristic",
    stage: "heuristic_fallback",
    model: "heuristic-fallback",
    status: "success",
    latencyMs: 0,
  });
  return {
    text: normalizeOutboundText(heuristicReply(args.inboundText)),
    provider: "heuristic",
    model: "heuristic-fallback",
    latencyMs: 0,
    guardrailBlocked: false,
    attempts,
  };
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
