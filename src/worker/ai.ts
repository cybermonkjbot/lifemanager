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

const HIGH_RISK_PATTERNS = [
  /password/i,
  /otp/i,
  /bank\s*account/i,
  /wire\s*transfer/i,
  /social\s*security/i,
];

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

  return pickVariant(input, [
    "Noted. I'm on it and I'll circle back soon.",
    "Sounds good. I'll handle it and update you soon.",
    "Got it, I'm on it.",
  ]);
}

function buildPrompt(args: {
  inboundText: string;
  historyLines: string[];
  styleHints: string[];
  styleProfile?: StyleProfileContext;
  personality?: PersonalityContext;
}) {
  const history = args.historyLines.slice(-14).join("\n");
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

  return [
    "You are writing one WhatsApp reply as the account owner.",
    "Write like a real person: warm, calm, confident, and practical.",
    "Default to 1-2 short sentences unless the message clearly needs more detail.",
    "Sound conversational and specific, never stiff or corporate.",
    "Do not mention AI, policies, prompt rules, or internal reasoning.",
    "Do not overpromise. If timing is uncertain, say you'll confirm shortly.",
    "Avoid generic fillers like 'Noted', 'As an AI', 'I hope this message finds you well', or repetitive templates.",
    mimicryInstruction,
    personalityLevelInstruction,
    personalityLabel ? `Selected relationship/personality mode: ${personalityLabel}` : "",
    args.personality?.profileDescription ? `Personality description: ${args.personality.profileDescription}` : "",
    args.personality?.profilePrompt ? `Personality behavior instruction: ${args.personality.profilePrompt}` : "",
    args.personality?.customPrompt ? `Thread-specific personality note: ${args.personality.customPrompt}` : "",
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

function sanitizeReplyText(raw: string) {
  let text = raw.trim();
  text = text.replace(/^reply\s*[:\-]\s*/i, "").trim();
  text = text.replace(/^["'`]+|["'`]+$/g, "").trim();
  text = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  if (text.length > 320) {
    text = text.slice(0, 320).trim();
  }

  return text;
}

function getAzureConfig() {
  return {
    endpoint: process.env.AZURE_AI_ENDPOINT || "",
    apiKey: process.env.AZURE_AI_API_KEY || "",
    model: process.env.AZURE_AI_MODEL || "gpt-4o-mini",
  };
}

async function runAzure(prompt: string): Promise<AiResult> {
  const cfg = getAzureConfig();
  if (!cfg.endpoint || !cfg.apiKey) {
    throw new Error("Azure AI endpoint/key missing.");
  }

  const start = Date.now();
  const messages = [
    {
      role: "system",
      content: "You write human WhatsApp replies that sound like the user and preserve conversational tone.",
    },
    {
      role: "user",
      content: prompt,
    },
  ];

  try {
    const client = ModelClient(cfg.endpoint, new AzureKeyCredential(cfg.apiKey));
    const response = await client.path("/chat/completions").post({
      body: {
        model: cfg.model,
        messages,
        max_tokens: 120,
        temperature: 0.7,
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

    const cleaned = sanitizeReplyText(text);
    if (!cleaned) {
      throw new Error("Azure AI returned empty response.");
    }

    return {
      text: cleaned,
      provider: "azure",
      model: cfg.model,
      latencyMs: Date.now() - start,
      guardrailBlocked: false,
    };
  } catch {
    // Fallback for environments where endpoint is a full REST URL instead of model client base URL.
    const response = await fetch(cfg.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": cfg.apiKey,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: 0.7,
        max_tokens: 120,
      }),
    });

    const latencyMs = Date.now() - start;
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

    const cleaned = sanitizeReplyText(text);
    if (!cleaned) {
      throw new Error("Azure AI returned empty response.");
    }

    return {
      text: cleaned,
      provider: "azure",
      model: cfg.model,
      latencyMs,
      guardrailBlocked: false,
    };
  }
}

async function runCodex(prompt: string): Promise<AiResult> {
  const codexPath = process.env.CODEX_CLI_PATH || "codex";
  const model = process.env.CODEX_FALLBACK_MODEL || "gpt-5.2";
  const outFile = join(tmpdir(), `slm-codex-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
  const start = Date.now();

  await execFileAsync(codexPath, ["exec", "--model", model, "--output-last-message", outFile, prompt], {
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });

  const text = sanitizeReplyText(await fs.readFile(outFile, "utf8"));
  await fs.unlink(outFile).catch(() => undefined);

  if (!text) {
    throw new Error("Codex fallback returned empty output.");
  }

  return {
    text,
    provider: "codex",
    model,
    latencyMs: Date.now() - start,
    guardrailBlocked: false,
  };
}

export async function generateReplyWithFallback(args: {
  inboundText: string;
  historyLines: string[];
  styleHints: string[];
  styleProfile?: StyleProfileContext;
  personality?: PersonalityContext;
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
    };
  }

  const prompt = buildPrompt(args);

  try {
    return await runAzure(prompt);
  } catch {
    try {
      return await runCodex(prompt);
    } catch {
      return {
        text: heuristicReply(args.inboundText),
        provider: "heuristic",
        model: "heuristic-fallback",
        latencyMs: 0,
        guardrailBlocked: false,
      };
    }
  }
}

export function estimateDelayAndTyping(text: string) {
  const len = Math.max(text.length, 10);
  const minDelay = Number(process.env.SLM_DELAY_MIN_MS || 12_000);
  const maxDelay = Number(process.env.SLM_DELAY_MAX_MS || 65_000);
  const minTyping = Number(process.env.SLM_TYPING_MIN_MS || 2_500);
  const maxTyping = Number(process.env.SLM_TYPING_MAX_MS || 9_000);

  const delayMs = Math.round(minDelay + (maxDelay - minDelay) * Math.min(len / 320, 1));
  const typingMs = Math.round(minTyping + (maxTyping - minTyping) * Math.min(len / 220, 1));

  return { delayMs, typingMs };
}
