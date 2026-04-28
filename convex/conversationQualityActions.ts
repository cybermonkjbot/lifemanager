"use node";

import { createDecipheriv, createHash } from "node:crypto";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { sanitizeAnalyzerFinding, type AnalyzerFinding, type QualityThreadSample } from "./lib/conversationQuality";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MODEL = "gpt-5.4";
const DEFAULT_ENDPOINT = "https://api.openai.com/v1";
const REQUEST_TIMEOUT_MS = 90_000;

const buildDailySampleRef = makeFunctionReference<"query">("conversationQuality:buildDailySample");
const startRunRef = makeFunctionReference<"mutation">("conversationQuality:startRun");
const completeRunRef = makeFunctionReference<"mutation">("conversationQuality:completeRun");
const failRunRef = makeFunctionReference<"mutation">("conversationQuality:failRun");
const getEncryptedSecretRef = makeFunctionReference<"query">("adminSecrets:getEncryptedInternal");

type EncryptedManagedSecret = {
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  encryptedValue: string;
};

type DailySample = {
  windowStartAt: number;
  windowEndAt: number;
  selectedThreads: QualityThreadSample[];
  candidateThreadCount: number;
};

type AiRuntime = {
  endpoint: string;
  apiKey: string;
  model: string;
  apiStyle: "responses" | "chat_completions";
};

const ENV_FALLBACKS: Record<string, string[]> = {
  "azure.ai.endpoint": ["AZURE_AI_ENDPOINT", "AZURE_OPENAI_ENDPOINT", "OPENAI_BASE_URL"],
  "azure.ai.apiKey": ["AZURE_AI_API_KEY", "AZURE_OPENAI_API_KEY", "OPENAI_API_KEY"],
  "azure.ai.model": ["AZURE_AI_MODEL", "AZURE_OPENAI_MODEL", "OPENAI_MODEL"],
  "azure.ai.apiStyle": ["AZURE_AI_API_STYLE"],
};

function readEnv(key: string) {
  for (const envName of ENV_FALLBACKS[key] || []) {
    const value = process.env[envName]?.trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function managedSecretsKey() {
  return process.env.ODOGWU_MANAGED_SECRETS_KEY?.trim() || process.env.SLM_MANAGED_SECRETS_KEY?.trim() || "";
}

function decryptManagedSecret(payload: EncryptedManagedSecret, secret: string) {
  if (payload.algorithm !== "aes-256-gcm") {
    throw new Error("Unsupported managed secret encryption algorithm.");
  }
  const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.encryptedValue, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

async function resolveSecret(ctx: ActionCtx, key: string) {
  const secret = managedSecretsKey();
  if (secret) {
    try {
      const stored = (await ctx.runQuery(getEncryptedSecretRef, { key })) as EncryptedManagedSecret | null;
      if (stored) {
        const value = decryptManagedSecret(stored, secret).trim();
        if (value) {
          return value;
        }
      }
    } catch {
      // Fall back to Convex environment variables below.
    }
  }
  return readEnv(key);
}

function normalizeEndpoint(endpoint: string) {
  return (endpoint || DEFAULT_ENDPOINT).trim().replace(/\/+$/, "");
}

function normalizeApiStyle(value: string): AiRuntime["apiStyle"] {
  return value === "chat_completions" ? "chat_completions" : "responses";
}

async function resolveAiRuntime(ctx: ActionCtx): Promise<AiRuntime | null> {
  const apiKey = await resolveSecret(ctx, "azure.ai.apiKey");
  if (!apiKey) {
    return null;
  }
  const endpoint = normalizeEndpoint((await resolveSecret(ctx, "azure.ai.endpoint")) || DEFAULT_ENDPOINT);
  const model = (await resolveSecret(ctx, "azure.ai.model")) || process.env.CODEX_FALLBACK_MODEL || DEFAULT_MODEL;
  const apiStyle = normalizeApiStyle((await resolveSecret(ctx, "azure.ai.apiStyle")) || "responses");
  return {
    endpoint,
    apiKey,
    model,
    apiStyle,
  };
}

function withTimeout(ms: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

function responseTextFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string") {
    return record.output_text;
  }
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const firstChoice = choices[0] as Record<string, unknown> | undefined;
  const message = firstChoice?.message as Record<string, unknown> | undefined;
  if (typeof message?.content === "string") {
    return message.content;
  }
  const output = Array.isArray(record.output) ? record.output : [];
  const texts: string[] = [];
  for (const item of output) {
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const part of content) {
      const partRecord = part as Record<string, unknown>;
      if (typeof partRecord.text === "string") {
        texts.push(partRecord.text);
      }
    }
  }
  return texts.join("\n").trim();
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]) as unknown;
    } catch {
      return null;
    }
  }
}

function normalizeFindingsFromPayload(payload: unknown) {
  const parsed = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
  return rawFindings
    .map((finding) => sanitizeAnalyzerFinding(finding as Partial<AnalyzerFinding>))
    .filter((finding): finding is AnalyzerFinding => Boolean(finding))
    .slice(0, 10);
}

function buildAnalyzerPrompt(sample: DailySample) {
  return [
    "Review these bounded conversation samples from an automated outbound messaging system.",
    "Find recurring conversational capability problems, not one-off awkward replies.",
    "Use the raw excerpts as evidence. Do not include sensitive advice beyond diagnosing product behavior.",
    "Return only JSON with this shape:",
    '{"findings":[{"title":"...","category":"...","severity":"low|medium|high","problemStatement":"...","evidenceSummary":"...","evidence":[{"threadId":"...","threadTitle":"...","messageId":"...","messageAt":123,"excerpt":"..."}],"suggestedFixPrompt":"..."}]}',
    "",
    "Each suggestedFixPrompt must be implementation-oriented for Codex. It should ask Codex to inspect before editing and mention likely affected areas such as worker reply generation, guardrails, style profiles, context recall, routing, or tests.",
    "Only create a finding when the pattern is visible across multiple turns or has high user-facing risk.",
    "",
    JSON.stringify(
      {
        windowStartAt: sample.windowStartAt,
        windowEndAt: sample.windowEndAt,
        candidateThreadCount: sample.candidateThreadCount,
        selectedThreads: sample.selectedThreads,
      },
      null,
      2,
    ),
  ].join("\n");
}

async function callAnalyzerModel(runtime: AiRuntime, prompt: string) {
  const isAzure = /\.openai\.azure\.com/i.test(runtime.endpoint) || /\/openai\/deployments\//i.test(runtime.endpoint);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(isAzure ? { "api-key": runtime.apiKey } : { authorization: `Bearer ${runtime.apiKey}` }),
  };
  const request = withTimeout(REQUEST_TIMEOUT_MS);
  const url =
    runtime.apiStyle === "chat_completions"
      ? `${runtime.endpoint}/chat/completions`
      : `${runtime.endpoint}/responses`;
  const body =
    runtime.apiStyle === "chat_completions"
      ? {
          model: runtime.model,
          messages: [
            { role: "system", content: "You are a precise conversation quality reviewer for an AI messaging product." },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
          max_tokens: 3_000,
          response_format: { type: "json_object" },
        }
      : {
          model: runtime.model,
          input: [
            { role: "system", content: "You are a precise conversation quality reviewer for an AI messaging product." },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
          max_output_tokens: 3_000,
          text: { format: { type: "json_object" } },
        };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: request.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`Analyzer model failed (${response.status}): ${raw.slice(0, 500)}`);
    }
    const payload = JSON.parse(raw) as unknown;
    const text = responseTextFromPayload(payload);
    const parsed = extractJsonObject(text || raw);
    return normalizeFindingsFromPayload(parsed);
  } finally {
    request.clear();
  }
}

function buildFallbackFindings(sample: DailySample) {
  const manualInterventionThreads = sample.selectedThreads.filter((thread) => thread.manualInterventionCount > 0);
  if (manualInterventionThreads.length < 2) {
    return [];
  }

  const evidence = manualInterventionThreads.slice(0, 4).flatMap((thread) =>
    thread.excerpts
      .filter((excerpt) => excerpt.automatedOutbound)
      .slice(0, 1)
      .map((excerpt) => ({
        threadId: thread.threadId,
        threadTitle: thread.title,
        messageId: excerpt.messageId,
        messageAt: excerpt.messageAt,
        excerpt: excerpt.text,
      })),
  );
  if (evidence.length < 2) {
    return [];
  }

  return [
    {
      title: "Automated replies often need manual correction",
      category: "manual_intervention_after_auto_reply",
      severity: "medium" as const,
      problemStatement:
        "Multiple active threads had manual outbound messages after automated outbound replies, which suggests the system may be missing context, tone, or pacing constraints that require owner correction.",
      evidenceSummary: `${manualInterventionThreads.length} sampled threads had manual outbound intervention near automated replies.`,
      evidence,
      suggestedFixPrompt:
        "Inspect the worker reply generation, guardrails, style profile use, context recall, and tests for why automated replies are being followed by manual correction in active conversations. Use the provided conversation-quality finding as evidence, add focused regression tests for the detected pattern, and implement the smallest safe fix.",
    },
  ];
}

function readAdminSecret() {
  return process.env.ODOGWU_CONVEX_ADMIN_SECRET || process.env.ODOGWU_ADMIN_SECRET || process.env.SLM_ADMIN_SECRET || "";
}

function requireAdmin(adminSecret: string) {
  const expected = readAdminSecret();
  if (!expected || adminSecret !== expected) {
    throw new Error("Unauthorized.");
  }
}

async function runConversationQualityReview(ctx: ActionCtx, args: { now?: number; maxThreads?: number }) {
  const now = Number.isFinite(args.now) ? Number(args.now) : Date.now();
  const windowStartAt = now - DAY_MS;
  const windowEndAt = now;
  const runtime = await resolveAiRuntime(ctx);
  const sample = (await ctx.runQuery(buildDailySampleRef, {
    windowStartAt,
    windowEndAt,
    maxThreads: args.maxThreads,
  })) as DailySample;
  const runId = (await ctx.runMutation(startRunRef, {
    windowStartAt,
    windowEndAt,
    model: runtime?.model || "heuristic-fallback",
    selectedThreadCount: sample.selectedThreads.length,
  })) as Id<"conversationQualityRuns">;

  try {
    let findings: AnalyzerFinding[] = [];
    let status: "success" | "warning" = "success";
    let errorMessage: string | undefined;
    if (sample.selectedThreads.length > 0 && runtime) {
      findings = await callAnalyzerModel(runtime, buildAnalyzerPrompt(sample));
    } else if (sample.selectedThreads.length > 0) {
      findings = buildFallbackFindings(sample);
      status = "warning";
      errorMessage = "AI runtime was not configured; used heuristic fallback.";
    }

    await ctx.runMutation(completeRunRef, {
      runId,
      model: runtime?.model || "heuristic-fallback",
      status,
      analyzedThreadCount: sample.selectedThreads.length,
      ...(errorMessage ? { errorMessage } : {}),
      findings,
    });
    return { runId, findingCount: findings.length, selectedThreadCount: sample.selectedThreads.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.runMutation(failRunRef, {
      runId,
      errorMessage: message,
      analyzedThreadCount: sample.selectedThreads.length,
    });
    throw error;
  }
}

export const runDaily = internalAction({
  args: {
    now: v.optional(v.number()),
    maxThreads: v.optional(v.number()),
  },
  handler: async (ctx, args) => runConversationQualityReview(ctx, args),
});

export const runManual = action({
  args: {
    adminSecret: v.string(),
    maxThreads: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    return await runConversationQualityReview(ctx, {
      maxThreads: args.maxThreads,
    });
  },
});
