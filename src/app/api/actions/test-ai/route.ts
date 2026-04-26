import {
  buildAiFreshnessFingerprint,
  getAiFreshnessCachedValue,
  setAiFreshnessCachedValue,
} from "@/lib/ai-freshness";
import { createConvexClient } from "@/lib/convex-server";
import { convexRefs } from "@/lib/convex-refs";
import { requireInstanceApiAccess } from "@/lib/instance-guard";
import { generateReplyWithFallback } from "@/worker/ai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
const MAX_TEST_AI_MESSAGE_CHARS = 8000;
type TestAiPurpose = "reply_test" | "todo_title" | "followup_reason";

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
  return "Failed to generate AI test response.";
}

export async function POST(request: Request) {
  const unauthorized = await requireInstanceApiAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  let payload: { message?: unknown; threadId?: unknown; purpose?: unknown };

  try {
    payload = (await request.json()) as { message?: unknown; threadId?: unknown; purpose?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  const threadId = typeof payload.threadId === "string" && payload.threadId.trim() ? payload.threadId.trim() : undefined;
  const purpose: TestAiPurpose =
    payload.purpose === "todo_title" || payload.purpose === "followup_reason" ? payload.purpose : "reply_test";

  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  if (message.length > MAX_TEST_AI_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `Message is too long. Keep it under ${MAX_TEST_AI_MESSAGE_CHARS} characters.` },
      { status: 400 },
    );
  }

  try {
    const convex = createConvexClient();

    await convex
      .mutation(convexRefs.systemRecordEvent, {
        source: "dashboard",
        eventType: "ai.test.requested",
        detail: `Dashboard AI test requested: ${compactText(message, 180)}`,
        ...(threadId ? { threadId } : {}),
      })
      .catch(() => undefined);

    const [runtimeSettings, globalStyleProfile] = (await Promise.all([
      convex.query(convexRefs.settingsGet, {}),
      convex.query(convexRefs.styleGetProfile, {}),
    ])) as [RuntimeSettings | null, StyleProfile | null];

    let historyLines: string[] = [];
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
        historyLines = threadContext.messages.map((messageItem) => {
          return `${messageItem.direction === "inbound" ? "Them" : "Me"}: ${messageItem.text}`;
        });
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

    const freshnessKey = buildAiFreshnessFingerprint({
      scope:
        purpose === "todo_title"
          ? "test_ai_todo_title"
          : purpose === "followup_reason"
            ? "test_ai_followup_reason"
            : "test_ai",
      inboundText: message,
      threadId,
      historyLines,
      styleHints,
      styleProfile: scopedStyleProfile || globalStyleProfile || null,
      personality,
      contactFacts,
      activePersonaPackId: runtimeSettings?.activePersonaPackId || "",
      activePersonaPackIdsByProfile: runtimeSettings?.activePersonaPackIdsByProfile || {},
      qualityGateMode: runtimeSettings?.qualityGateMode,
      qualityGateThreshold: runtimeSettings?.qualityGateThreshold,
      model: runtimeSettings?.aiModelFirstEnabled ? "model_first" : undefined,
      temperature: runtimeSettings?.aiTemperature,
      maxOutputTokens: runtimeSettings?.aiMaxOutputTokens,
    });
    const cached = getAiFreshnessCachedValue<{
      replyText: string;
      provider: string;
      model: string;
      latencyMs: number;
      guardrailBlocked: boolean;
      guardrailReason?: string;
      attempts: unknown[];
      contextToolCalls: unknown[];
      contextWindow: unknown;
      qualityScore?: number;
      qualityChecks: unknown[];
      qualityRewriteApplied: boolean;
      activePersonaPackId: string | null;
      activeDynamicStylePackIds?: string[];
      conversationStyleMatrix?: unknown;
      createdAt: number;
      usedThreadContext: boolean;
      threadId: string | null;
      freshness: { cacheHit: boolean; ageMs: number };
    }>(freshnessKey);
    if (cached) {
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "dashboard",
          eventType: "ai.test.freshness.hit",
          detail: `Dashboard AI test reused fresh cached result (${cached.ageMs}ms old).`,
          ...(threadId ? { threadId } : {}),
        })
        .catch(() => undefined);

      return NextResponse.json({
        ...cached.value,
        freshness: {
          cacheHit: true,
          ageMs: cached.ageMs,
        },
      });
    }

    const aiResult = await generateReplyWithFallback({
      inboundText: message,
      historyLines,
      contactFacts,
      styleHints,
      styleProfile: scopedStyleProfile || globalStyleProfile || undefined,
      personality,
      runtime: {
        temperature: runtimeSettings?.aiTemperature,
        maxOutputTokens: runtimeSettings?.aiMaxOutputTokens,
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
        disableRecentSelfRepeatGuardrail: purpose === "todo_title" || purpose === "followup_reason",
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
          ? ` · tokens ${attempt.inputTokens ?? 0}/${attempt.outputTokens ?? 0}/${attempt.totalTokens ?? (attempt.inputTokens ?? 0) + (attempt.outputTokens ?? 0)}`
          : "";
      const costSuffix = attempt.estimatedCostUsd === undefined ? "" : ` · est. cost $${attempt.estimatedCostUsd.toFixed(6)}`;
      const detail = attempt.error
        ? `Dashboard test attempt ${index + 1}/${aiResult.attempts.length} · ${attempt.stage} · ${attempt.model} · ${attempt.latencyMs}ms${usageSuffix}${costSuffix} · ${compactText(attempt.error, 180)}`
        : `Dashboard test attempt ${index + 1}/${aiResult.attempts.length} · ${attempt.stage} · ${attempt.model} · ${attempt.latencyMs}ms${usageSuffix}${costSuffix}`;

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
          eventType: `ai.test.attempt.${attempt.stage}.${attempt.status}`,
          detail,
          ...(threadId ? { threadId } : {}),
        })
        .catch(() => undefined);
    }

    await convex
      .mutation(convexRefs.systemRecordEvent, {
        source: "dashboard",
        eventType: aiResult.guardrailBlocked ? "ai.test.blocked" : "ai.test.generated",
        detail: aiResult.guardrailBlocked
          ? aiResult.guardrailReason || "Dashboard AI test blocked by guardrail."
          : `Dashboard AI test generated via ${aiResult.provider}/${aiResult.model} in ${aiResult.latencyMs}ms.`,
        ...(threadId ? { threadId } : {}),
      })
      .catch(() => undefined);

    const responsePayload = {
      replyText: aiResult.text,
      provider: aiResult.provider,
      model: aiResult.model,
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
      createdAt: Date.now(),
      usedThreadContext: historyLines.length > 0,
      threadId: threadId || null,
      freshness: {
        cacheHit: false,
        ageMs: 0,
      },
    };

    setAiFreshnessCachedValue(freshnessKey, responsePayload);
    return NextResponse.json(responsePayload);
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
