import { createConvexClient } from "@/lib/convex-server";
import { convexRefs } from "@/lib/convex-refs";
import { generateReplyWithFallback } from "@/worker/ai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type RuntimeSettings = {
  soulModeEnabled?: boolean;
  funnyStatusKeywords?: string[];
  funnyStatusEmojis?: string[];
  aiTemperature?: number;
  aiMaxOutputTokens?: number;
  aiMaxReplyChars?: number;
  aiHistoryLineLimit?: number;
  aiFallbackMode?: "all" | "azure_only";
  aiReplyPolicy?: string;
  aiSystemInstruction?: string;
  activePersonaPackId?: string;
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
};

type ContactMemoryFact = {
  factValue: string;
  factType: "preference" | "profile" | "schedule" | "relationship" | "promise" | "other";
};

type ThreadContext = {
  messages: Array<{ direction: "inbound" | "outbound"; text: string }>;
  memory?: { styleNotes?: string[] } | null;
};

type PersonalitySetting = {
  profileSlug?: string;
  intensity?: number;
  customPrompt?: string;
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
  let payload: { message?: unknown; threadId?: unknown };

  try {
    payload = (await request.json()) as { message?: unknown; threadId?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  const threadId = typeof payload.threadId === "string" && payload.threadId.trim() ? payload.threadId.trim() : undefined;

  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  if (message.length > 2400) {
    return NextResponse.json({ error: "Message is too long. Keep it under 2400 characters." }, { status: 400 });
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
    let personality: {
      profileSlug?: string;
      profileName?: string;
      profileDescription?: string;
      profilePrompt?: string;
      intensity?: number;
      customPrompt?: string;
    } | undefined;

    if (threadId) {
      const threadContext = (await convex.query(convexRefs.threadGet, { threadId }).catch(() => null)) as ThreadContext | null;
      if (threadContext) {
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
      const factHints = (factsBundle?.facts || []).map((fact) => `Known contact fact (${fact.factType}): ${fact.factValue}`);
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

    const aiResult = await generateReplyWithFallback({
      inboundText: message,
      historyLines,
      styleHints,
      styleProfile: scopedStyleProfile || globalStyleProfile || undefined,
      personality,
      runtime: {
        temperature: runtimeSettings?.aiTemperature,
        maxOutputTokens: runtimeSettings?.aiMaxOutputTokens,
        maxReplyChars: runtimeSettings?.aiMaxReplyChars,
        historyLineLimit: runtimeSettings?.aiHistoryLineLimit,
        fallbackMode: runtimeSettings?.aiFallbackMode,
        replyPolicyInstruction: runtimeSettings?.aiReplyPolicy || "",
        systemInstruction: runtimeSettings?.aiSystemInstruction || "",
        activePersonaPackId: runtimeSettings?.activePersonaPackId || "",
        qualityGateMode: runtimeSettings?.qualityGateMode,
        qualityGateThreshold: runtimeSettings?.qualityGateThreshold,
        soulModeEnabled: runtimeSettings?.soulModeEnabled,
        funnyStatusKeywords: runtimeSettings?.funnyStatusKeywords,
        funnyStatusEmojis: runtimeSettings?.funnyStatusEmojis,
        delayMinMs: runtimeSettings?.humanDelayMinMs,
        delayMaxMs: runtimeSettings?.humanDelayMaxMs,
        typingMinMs: runtimeSettings?.humanTypingMinMs,
        typingMaxMs: runtimeSettings?.humanTypingMaxMs,
      },
    });

    for (let index = 0; index < aiResult.attempts.length; index += 1) {
      const attempt = aiResult.attempts[index];
      const detail = attempt.error
        ? `Dashboard test attempt ${index + 1}/${aiResult.attempts.length} · ${attempt.stage} · ${attempt.model} · ${attempt.latencyMs}ms · ${compactText(attempt.error, 180)}`
        : `Dashboard test attempt ${index + 1}/${aiResult.attempts.length} · ${attempt.stage} · ${attempt.model} · ${attempt.latencyMs}ms`;

      await convex
        .mutation(convexRefs.systemRecordProviderRun, {
          provider: attempt.provider,
          model: attempt.model,
          latencyMs: attempt.latencyMs,
          status: attempt.status,
          ...(threadId ? { threadId } : {}),
          ...(attempt.error ? { error: compactText(attempt.error, 300) } : {}),
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

    return NextResponse.json({
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
      createdAt: Date.now(),
      usedThreadContext: historyLines.length > 0,
      threadId: threadId || null,
    });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
