import {
  buildAiFreshnessFingerprint,
  getAiFreshnessCachedValue,
  setAiFreshnessCachedValue,
} from "@/lib/ai-freshness";
import { createConvexClient } from "@/lib/convex-server";
import { convexRefs } from "@/lib/convex-refs";
import { gatewayApiKeyConfigured, requestHasGatewayApiKey } from "@/lib/api-gateway-auth";
import { getCurrentHostedBillingGate } from "@/lib/billing-access";
import { getManagedAiRuntimeOverrides } from "@/lib/managed-secrets-server";
import {
  MAX_GATEWAY_INBOUND_CHARS,
  buildOpenAiChatCompletion,
  buildOpenAiErrorBody,
  mapOpenAiMessagesToInboundAndHistory,
  resolveGatewayRuntimeModel,
  resolveGatewayThreadId,
} from "@/lib/openai-gateway";
import { consumeRequestRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { generateReplyWithFallback } from "@/worker/ai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_EVENT_DETAIL_CHARS = 260;
const CORS_BASE_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-API-Key",
};

type RuntimeSettings = {
  soulModeEnabled?: boolean;
  selfRoastModeEnabled?: boolean;
  funnyStatusKeywords?: string[];
  funnyStatusEmojis?: string[];
  aiTemperature?: number;
  aiMaxOutputTokens?: number;
  aiMaxReplyChars?: number;
  aiHistoryLineLimit?: number;
  aiFallbackMode?: "all" | "azure_only";
  aiModelFirstEnabled?: boolean;
  aiDeterministicModes?: string[];
  aiAckRoutingEnabled?: boolean;
  aiReplyPolicy?: string;
  aiSystemInstruction?: string;
  activePersonaPackId?: string;
  activePersonaPackIdsByProfile?: Record<string, string>;
  qualityGateMode?: "auto_rewrite_once" | "manual_review" | "log_only";
  qualityGateThreshold?: number;
  humanDelayMinMs?: number;
  humanDelayMaxMs?: number;
  humanTypingMinMs?: number;
  humanTypingMaxMs?: number;
};

type StyleProfile = {
  mimicryLevel?: number;
  commonPhrases?: string[];
  punctuationStyle?: string[];
  humorNotes?: string[];
  spellingNotes?: string[];
  learnedEmojiAllowlist?: string[];
  learnedEmojiCategoryHints?: string[];
};

type ContactMemoryFact = {
  factValue: string;
  factType: "preference" | "profile" | "schedule" | "relationship" | "promise" | "other";
  confidence?: number;
};

type ThreadContext = {
  thread?: { jid?: string } | null;
  messages: Array<{ direction: "inbound" | "outbound"; text: string }>;
  memory?: { styleNotes?: string[] } | null;
};

type PersonalitySetting = {
  profileSlug?: string;
  intensity?: number;
  customPrompt?: string;
  threadPromptProfile?: string;
  threadPromptProfileSource?: "manual" | "auto";
  profile?: {
    slug?: string;
    name?: string;
    description?: string;
    prompt?: string;
  } | null;
};

type OpenAiGatewayPayload = {
  model?: unknown;
  messages?: unknown;
  stream?: unknown;
  temperature?: unknown;
  max_tokens?: unknown;
  max_completion_tokens?: unknown;
  metadata?: unknown;
  user?: unknown;
  threadId?: unknown;
  thread_id?: unknown;
};

function compactText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars - 3)}...`;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Internal gateway error.";
}

function parseOptionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parseTemperature(value: unknown) {
  const parsed = parseOptionalNumber(value);
  if (parsed === undefined) {
    return undefined;
  }
  return Math.max(0, Math.min(parsed, 2));
}

function parseMaxOutputTokens(payload: OpenAiGatewayPayload) {
  const parsed = parseOptionalNumber(payload.max_completion_tokens ?? payload.max_tokens);
  if (parsed === undefined) {
    return undefined;
  }
  const rounded = Math.round(parsed);
  if (!Number.isFinite(rounded) || rounded <= 0) {
    return undefined;
  }
  return Math.min(rounded, 8_192);
}

function buildHeaders(extra?: HeadersInit) {
  const headers = new Headers(CORS_BASE_HEADERS);
  if (extra) {
    const additional = new Headers(extra);
    additional.forEach((value, key) => {
      headers.set(key, value);
    });
  }
  return headers;
}

function openAiErrorResponse(
  status: number,
  message: string,
  type: "invalid_request_error" | "authentication_error" | "api_error",
  code?: string,
  extraHeaders?: HeadersInit,
) {
  return NextResponse.json(buildOpenAiErrorBody(message, type, code), {
    status,
    headers: buildHeaders(extraHeaders),
  });
}

function gatewayRateLimitIdentity(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const apiKey = request.headers.get("x-api-key") || "";
  return authorization || apiKey || "missing-key";
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: buildHeaders({
      "Access-Control-Max-Age": "86400",
    }),
  });
}

export async function POST(request: Request) {
  if (!gatewayApiKeyConfigured()) {
    return openAiErrorResponse(
      503,
      "API access is not available for this account yet.",
      "api_error",
      "gateway_disabled",
    );
  }

  if (!requestHasGatewayApiKey(request.headers)) {
    return openAiErrorResponse(
      401,
      "Invalid or missing API key.",
      "authentication_error",
      "invalid_api_key",
      { "WWW-Authenticate": 'Bearer realm="slm-api-gateway"' },
    );
  }

  const rateLimit = await consumeRequestRateLimit(request, {
    scope: "api.gateway.chat",
    identity: gatewayRateLimitIdentity(request),
    limit: 30,
    windowMs: 60 * 1000,
    penaltyMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return openAiErrorResponse(
      429,
      "Rate limit exceeded. Try again shortly.",
      "api_error",
      "rate_limit_exceeded",
      rateLimitHeaders(rateLimit),
    );
  }

  const billingGate = await getCurrentHostedBillingGate();
  if (billingGate.billingRequired) {
    return openAiErrorResponse(
      402,
      "Choose a plan to keep using the API gateway.",
      "api_error",
      "billing_required",
    );
  }

  let payload: OpenAiGatewayPayload;
  try {
    payload = (await request.json()) as OpenAiGatewayPayload;
  } catch {
    return openAiErrorResponse(400, "Invalid JSON body.", "invalid_request_error");
  }

  if (payload.stream === true) {
    return openAiErrorResponse(
      400,
      "Streaming is not supported yet. Send requests with `stream: false`.",
      "invalid_request_error",
      "unsupported_stream",
    );
  }

  let inboundText = "";
  let requestHistoryLines: string[] = [];
  try {
    const mapped = mapOpenAiMessagesToInboundAndHistory(payload.messages);
    inboundText = mapped.inboundText;
    requestHistoryLines = mapped.historyLines;
  } catch (error) {
    return openAiErrorResponse(400, getErrorMessage(error), "invalid_request_error");
  }

  if (!inboundText) {
    return openAiErrorResponse(400, "A non-empty user message is required.", "invalid_request_error");
  }

  if (inboundText.length > MAX_GATEWAY_INBOUND_CHARS) {
    return openAiErrorResponse(
      400,
      `Inbound message is too long. Keep it under ${MAX_GATEWAY_INBOUND_CHARS} characters.`,
      "invalid_request_error",
    );
  }

  const requestModel = typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : "slm-gateway";
  const runtimeModel = resolveGatewayRuntimeModel(payload.model);
  const threadId = resolveGatewayThreadId(payload);
  const requestTemperature = parseTemperature(payload.temperature);
  const requestMaxOutputTokens = parseMaxOutputTokens(payload);

  try {
    const convex = createConvexClient();

    await convex
      .mutation(convexRefs.systemRecordEvent, {
        source: "dashboard",
        eventType: "api.gateway.requested",
        detail: compactText(`API gateway request model=${requestModel} inbound=${inboundText}`, MAX_EVENT_DETAIL_CHARS),
        ...(threadId ? { threadId } : {}),
      })
      .catch(() => undefined);

    const [runtimeSettings, globalStyleProfile] = (await Promise.all([
      convex.query(convexRefs.settingsGet, {}),
      convex.query(convexRefs.styleGetProfile, {}),
    ])) as [RuntimeSettings | null, StyleProfile | null];

    let combinedHistoryLines = requestHistoryLines;
    let styleHints: string[] = [];
    let contactFacts: ContactMemoryFact[] = [];
    let threadJid: string | undefined;
    let personality: {
      profileSlug?: string;
      profileName?: string;
      profileDescription?: string;
      profilePrompt?: string;
      intensity?: number;
      customPrompt?: string;
      threadPromptProfile?: string;
      threadPromptProfileSource?: "manual" | "auto";
    } | undefined;

    if (threadId) {
      const threadContext = (await convex.query(convexRefs.threadGet, { threadId }).catch(() => null)) as ThreadContext | null;
      if (threadContext) {
        threadJid = threadContext.thread?.jid || undefined;
        const threadHistoryLines = threadContext.messages.map((messageItem) => {
          return `${messageItem.direction === "inbound" ? "Them" : "Me"}: ${messageItem.text}`;
        });
        combinedHistoryLines = [...threadHistoryLines, ...requestHistoryLines];
        styleHints = threadContext.memory?.styleNotes || [];
      }

      await convex
        .mutation(convexRefs.chatExtractContactMemoryFacts, {
          threadId,
          lookbackMessages: 120,
        })
        .catch(() => undefined);
      const factsBundle = (await convex
        .query(convexRefs.chatContactMemoryFactsList, {
          threadId,
          limit: 8,
        })
        .catch(() => null)) as { facts?: ContactMemoryFact[] } | null;
      contactFacts = factsBundle?.facts || [];
      const factHints = contactFacts.map((fact) => `Known contact fact (${fact.factType}): ${fact.factValue}`);
      styleHints = [...styleHints, ...factHints];

      const personalitySetting = (await convex
        .query(convexRefs.personalityGetThreadSetting, { threadId })
        .catch(() => null)) as PersonalitySetting | null;

      if (personalitySetting) {
        personality = {
          profileSlug: personalitySetting.profileSlug || personalitySetting.profile?.slug,
          profileName: personalitySetting.profile?.name,
          profileDescription: personalitySetting.profile?.description,
          profilePrompt: personalitySetting.profile?.prompt,
          intensity: personalitySetting.intensity,
          customPrompt: personalitySetting.customPrompt || "",
          threadPromptProfile: personalitySetting.threadPromptProfile || "",
          threadPromptProfileSource: personalitySetting.threadPromptProfileSource,
        };
      }
    }

    const scopedStyleProfile = threadId
      ? ((await convex
          .query(convexRefs.chatGetThreadStyleProfile, {
            threadId,
            fallbackToGlobal: true,
          })
          .catch(() => null)) as { profile?: StyleProfile } | null)?.profile
      : null;

    const resolvedTemperature = requestTemperature ?? runtimeSettings?.aiTemperature;
    const resolvedMaxOutputTokens = requestMaxOutputTokens ?? runtimeSettings?.aiMaxOutputTokens;
    const freshnessKey = buildAiFreshnessFingerprint({
      scope: "gateway",
      inboundText,
      threadId,
      historyLines: combinedHistoryLines,
      styleHints,
      styleProfile: scopedStyleProfile || globalStyleProfile || null,
      personality,
      contactFacts,
      activePersonaPackId: runtimeSettings?.activePersonaPackId || "",
      activePersonaPackIdsByProfile: runtimeSettings?.activePersonaPackIdsByProfile || {},
      qualityGateMode: runtimeSettings?.qualityGateMode,
      qualityGateThreshold: runtimeSettings?.qualityGateThreshold,
      model: runtimeModel || requestModel,
      temperature: resolvedTemperature,
      maxOutputTokens: resolvedMaxOutputTokens,
    });

    const cached = getAiFreshnessCachedValue<{
      id: string;
      object: string;
      created: number;
      model: string;
      choices: unknown[];
      usage?: unknown;
      slm: Record<string, unknown>;
    }>(freshnessKey);
    if (cached) {
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "dashboard",
          eventType: "api.gateway.freshness.hit",
          detail: compactText(`Gateway reused fresh cached result (${cached.ageMs}ms old).`, MAX_EVENT_DETAIL_CHARS),
          ...(threadId ? { threadId } : {}),
        })
        .catch(() => undefined);

      return NextResponse.json(
        {
          ...cached.value,
          slm: {
            ...(cached.value.slm || {}),
            freshness: {
              cacheHit: true,
              ageMs: cached.ageMs,
            },
          },
        },
        {
          headers: buildHeaders({
            "Cache-Control": "no-store",
          }),
        },
      );
    }

    const managedAiRuntime = await getManagedAiRuntimeOverrides();
    const aiResult = await generateReplyWithFallback({
      inboundText,
      historyLines: combinedHistoryLines,
      contactFacts,
      styleHints,
      styleProfile: scopedStyleProfile || globalStyleProfile || undefined,
      personality,
      runtime: {
        ...managedAiRuntime,
        ...(runtimeModel ? { model: runtimeModel } : {}),
        ...(resolvedTemperature === undefined ? {} : { temperature: resolvedTemperature }),
        ...(resolvedMaxOutputTokens === undefined ? {} : { maxOutputTokens: resolvedMaxOutputTokens }),
        maxReplyChars: runtimeSettings?.aiMaxReplyChars,
        historyLineLimit: runtimeSettings?.aiHistoryLineLimit,
        fallbackMode: runtimeSettings?.aiFallbackMode,
        modelFirstEnabled: runtimeSettings?.aiModelFirstEnabled,
        deterministicModes: runtimeSettings?.aiDeterministicModes,
        ackRoutingEnabled: runtimeSettings?.aiAckRoutingEnabled,
        replyPolicyInstruction: runtimeSettings?.aiReplyPolicy || "",
        systemInstruction: runtimeSettings?.aiSystemInstruction || "",
        activePersonaPackId: runtimeSettings?.activePersonaPackId || "",
        activePersonaPackIdsByProfile: runtimeSettings?.activePersonaPackIdsByProfile || {},
        qualityGateMode: runtimeSettings?.qualityGateMode,
        qualityGateThreshold: runtimeSettings?.qualityGateThreshold,
        soulModeEnabled: runtimeSettings?.soulModeEnabled,
        selfRoastModeEnabled: runtimeSettings?.selfRoastModeEnabled,
        funnyStatusKeywords: runtimeSettings?.funnyStatusKeywords,
        funnyStatusEmojis: runtimeSettings?.funnyStatusEmojis,
        delayMinMs: runtimeSettings?.humanDelayMinMs,
        delayMaxMs: runtimeSettings?.humanDelayMaxMs,
        typingMinMs: runtimeSettings?.humanTypingMinMs,
        typingMaxMs: runtimeSettings?.humanTypingMaxMs,
      },
      modelToolContext: {
        threadId,
        contactJid: threadJid,
        executeToolRouterPlan: async (toolArgs) => {
          const maxResults = Number(toolArgs.maxResults);
          const maxToolsPerRun = Number(toolArgs.maxToolsPerRun);
          if (!Number.isFinite(maxResults) || maxResults > 20) {
            return {
              status: "error" as const,
              errorCode: "max_results_exceeded",
              errorMessage: "maxResults exceeds server cap (20).",
              latencyMs: 0,
            };
          }
          if (!Number.isFinite(maxToolsPerRun) || maxToolsPerRun > 8) {
            return {
              status: "error" as const,
              errorCode: "max_tools_per_run_exceeded",
              errorMessage: "maxToolsPerRun exceeds server cap (8).",
              latencyMs: 0,
            };
          }

          const startedAt = Date.now();
          try {
            const output = await convex.action(convexRefs.chatToolRouterPlan, {
              task: toolArgs.task,
              candidateReply: toolArgs.candidateReply || "",
              ...(threadId ? { threadId } : {}),
              ...(threadJid ? { contactJid: threadJid } : {}),
              execute: true,
              plannerMode: "hybrid",
              allowSideEffects: true,
              includeExtraction: Boolean(toolArgs.includeExtraction),
              timeoutMs: Math.round(Math.max(500, Math.min(toolArgs.toolTimeoutMs, 30_000))),
              maxResults: Math.round(Math.max(1, Math.min(maxResults, 20))),
              maxToolsPerRun: Math.round(Math.max(1, Math.min(maxToolsPerRun, 8))),
            });
            return {
              status: "success" as const,
              output,
              latencyMs: Date.now() - startedAt,
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const lower = message.toLowerCase();
            return {
              status: lower.includes("timeout") ? ("timeout" as const) : ("error" as const),
              errorCode: lower.includes("timeout") ? "timeout" : "tool_router_error",
              errorMessage: compactText(message, 260),
              latencyMs: Date.now() - startedAt,
            };
          }
        },
      },
    });

    for (let index = 0; index < aiResult.attempts.length; index += 1) {
      const attempt = aiResult.attempts[index];
      const usageSuffix =
        attempt.inputTokens !== undefined || attempt.outputTokens !== undefined || attempt.totalTokens !== undefined
          ? ` tokens ${attempt.inputTokens ?? 0}/${attempt.outputTokens ?? 0}/${attempt.totalTokens ?? (attempt.inputTokens ?? 0) + (attempt.outputTokens ?? 0)}`
          : "";

      await convex
        .mutation(convexRefs.systemRecordProviderRun, {
          provider: attempt.provider,
          model: attempt.model,
          latencyMs: attempt.latencyMs,
          status: attempt.status,
          ...(threadId ? { threadId } : {}),
          ...(attempt.error ? { error: compactText(attempt.error, 300) } : {}),
          ...(attempt.inputTokens === undefined ? {} : { inputTokens: attempt.inputTokens }),
          ...(attempt.outputTokens === undefined ? {} : { outputTokens: attempt.outputTokens }),
          ...(attempt.totalTokens === undefined ? {} : { totalTokens: attempt.totalTokens }),
          ...(attempt.usageSource ? { usageSource: attempt.usageSource } : {}),
          ...(attempt.estimatedCostUsd === undefined ? {} : { estimatedCostUsd: attempt.estimatedCostUsd }),
          ...(attempt.costCurrency ? { costCurrency: attempt.costCurrency } : {}),
          ...(attempt.pricingVersion ? { pricingVersion: attempt.pricingVersion } : {}),
        })
        .catch(() => undefined);

      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "dashboard",
          eventType: `api.gateway.attempt.${attempt.stage}.${attempt.status}`,
          detail: compactText(
            `Gateway attempt ${index + 1}/${aiResult.attempts.length} ${attempt.provider}/${attempt.model} ${attempt.latencyMs}ms${usageSuffix}${attempt.error ? ` ${attempt.error}` : ""}`,
            MAX_EVENT_DETAIL_CHARS,
          ),
          ...(threadId ? { threadId } : {}),
        })
        .catch(() => undefined);
    }

    await convex
      .mutation(convexRefs.systemRecordEvent, {
        source: "dashboard",
        eventType: aiResult.guardrailBlocked ? "api.gateway.blocked" : "api.gateway.generated",
        detail: aiResult.guardrailBlocked
          ? aiResult.guardrailReason || "Gateway reply blocked by guardrail."
          : `Gateway reply generated via ${aiResult.provider}/${aiResult.model} in ${aiResult.latencyMs}ms.`,
        ...(threadId ? { threadId } : {}),
      })
      .catch(() => undefined);

    const completion = buildOpenAiChatCompletion({
      text: aiResult.text,
      model: requestModel,
      attempts: aiResult.attempts,
      finishReason: aiResult.guardrailBlocked ? "content_filter" : "stop",
    });
    const responsePayload = {
      ...completion,
      slm: {
        provider: aiResult.provider,
        resolvedModel: aiResult.model,
        latencyMs: aiResult.latencyMs,
        guardrailBlocked: aiResult.guardrailBlocked,
        guardrailReason: aiResult.guardrailReason,
        attempts: aiResult.attempts,
        contextToolCalls: aiResult.contextToolCalls || [],
        contextWindow: aiResult.contextWindow || null,
        qualityScore: aiResult.qualityScore,
        qualityChecks: aiResult.qualityChecks || [],
        qualityRewriteApplied: aiResult.qualityRewriteApplied || false,
        activePersonaPackId: aiResult.activePersonaPackId || null,
        activeDynamicStylePackIds: aiResult.activeDynamicStylePackIds || [],
        conversationStyleMatrix: aiResult.conversationStyleMatrix || null,
        threadId: threadId || null,
        freshness: {
          cacheHit: false,
          ageMs: 0,
        },
      },
    };
    setAiFreshnessCachedValue(freshnessKey, responsePayload);

    return NextResponse.json(
      responsePayload,
      {
        headers: buildHeaders({
          "Cache-Control": "no-store",
        }),
      },
    );
  } catch (error) {
    return openAiErrorResponse(500, getErrorMessage(error), "api_error");
  }
}
