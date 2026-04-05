import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type AiResult = {
  text: string;
  provider: "azure" | "codex" | "heuristic";
  model: string;
  latencyMs: number;
  guardrailBlocked: boolean;
  guardrailReason?: string;
};

const HIGH_RISK_PATTERNS = [
  /password/i,
  /otp/i,
  /bank\s*account/i,
  /wire\s*transfer/i,
  /social\s*security/i,
];

function heuristicReply(input: string) {
  if (/\?|\b(can you|could you|when|where|what|why|how)\b/i.test(input)) {
    return "Yeah that works on my side. Give me a bit and I'll send details shortly.";
  }

  if (/\b(thanks|thank you)\b/i.test(input)) {
    return "Anytime. Happy to help.";
  }

  return "Noted. I’m on it and I’ll circle back soon.";
}

function buildPrompt(args: {
  inboundText: string;
  historyLines: string[];
  styleHints: string[];
}) {
  const history = args.historyLines.slice(-14).join("\n");
  const hints = args.styleHints.join(", ");

  return [
    "You are writing a WhatsApp reply as the user.",
    "Keep it concise and casual. Keep natural spelling and punctuation.",
    "Do not mention that you are an AI. Do not sound robotic.",
    hints ? `Style hints: ${hints}` : "",
    history ? `Recent chat:\n${history}` : "",
    `Latest inbound message: ${args.inboundText}`,
    "Return only the final reply text.",
  ]
    .filter(Boolean)
    .join("\n\n");
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
  const response = await fetch(cfg.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": cfg.apiKey,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        {
          role: "system",
          content:
            "You write human WhatsApp replies that sound like the user and preserve conversational tone.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
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

  if (!text.trim()) {
    throw new Error("Azure AI returned empty response.");
  }

  return {
    text: text.trim(),
    provider: "azure",
    model: cfg.model,
    latencyMs,
    guardrailBlocked: false,
  };
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

  const text = (await fs.readFile(outFile, "utf8")).trim();
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
