import makeWASocket, { Browsers, DisconnectReason, fetchLatestWaWebVersion, useMultiFileAuthState, type UserFacingSocketConfig } from "baileys";
import { rm } from "node:fs/promises";
import pino from "pino";
import { ConvexHttpClient } from "convex/browser";
import type { Id } from "../../convex/_generated/dataModel";
import { convexRefs } from "../lib/convex-refs";
import { acquireWorkerLock, releaseWorkerLockSync } from "../lib/runtime/worker-lock";
import { generateReplyWithFallback, estimateDelayAndTyping, normalizeOutboundText, type AiAttempt } from "./ai";
import { getSenderJid, getThreadJid, parseInboundMessage, type ParsedInboundMessage } from "./whatsapp";

const logger = pino({
  name: "slm-worker",
  level: process.env.LOG_LEVEL || "info",
});

type RuntimeSettings = {
  reactionsEnabled: boolean;
  stickersEnabled: boolean;
  memesEnabled: boolean;
  aiTemperature: number;
  aiMaxOutputTokens: number;
  aiMaxReplyChars: number;
  aiHistoryLineLimit: number;
  aiFallbackMode: "all" | "azure_only";
  aiPrimaryConfidence: number;
  aiFallbackConfidence: number;
  aiReplyPolicy: string;
  aiSystemInstruction: string;
  humanDelayMinMs: number;
  humanDelayMaxMs: number;
  humanTypingMinMs: number;
  humanTypingMaxMs: number;
  outboxClaimLimit: number;
  outboxPollMs: number;
};

const AI_OUTREACH_PLACEHOLDER = "__SLM_AI_OUTREACH__";

type OutboundPolicy =
  | {
      mode: "reaction_only";
      emoji: string;
    }
  | {
      mode: "reaction_plus_text";
      emoji: string;
    }
  | {
      mode: "sticker";
      mediaAssetId: string;
    }
  | {
      mode: "meme";
      mediaAssetId: string;
    }
  | {
      mode: "text";
    };

function chooseReactionEmoji(text: string) {
  if (/\b(thanks|thank you|thx)\b/i.test(text)) {
    return "🙏";
  }
  if (/\b(love|great|awesome|perfect)\b/i.test(text)) {
    return "❤️";
  }
  if (/\b(ok|okay|sure|alright|cool|noted|done)\b/i.test(text)) {
    return "👍";
  }
  return "👍";
}

function looksLikeAckOnly(text: string) {
  const trimmed = text.trim();
  if (trimmed.length > 40) {
    return false;
  }
  return /\b(ok|okay|sure|cool|great|thanks|thank you|noted|done|alright)\b/i.test(trimmed);
}

function shouldUseMeme(text: string) {
  return /\b(meme|lol|lmao|funny|joke|banter)\b/i.test(text);
}

function positiveTone(text: string) {
  return /\b(lol|haha|nice|great|love|amazing|awesome|cool)\b/i.test(text);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(value, max));
}

function normalizeIncomingMessageTimestamp(rawTimestamp: unknown, fallbackMs: number) {
  const parsed = Number(rawTimestamp);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackMs;
  }
  if (parsed < 10_000_000_000) {
    return parsed * 1000;
  }
  return parsed;
}

function attemptStageLabel(stage: AiAttempt["stage"]) {
  switch (stage) {
    case "azure_responses":
      return "Azure Responses";
    case "azure_sdk":
      return "Azure SDK";
    case "azure_http":
      return "Azure HTTP fallback";
    case "codex_cli":
      return "Codex CLI fallback";
    case "heuristic_guardrail":
      return "Heuristic guardrail";
    case "heuristic_fallback":
      return "Heuristic fallback";
    default:
      return stage;
  }
}

function attemptEventType(attempt: AiAttempt) {
  if (attempt.stage === "heuristic_guardrail") {
    return "ai.guardrail.blocked";
  }
  if (attempt.stage === "heuristic_fallback") {
    return "ai.fallback.heuristic.used";
  }
  if (attempt.stage === "codex_cli") {
    return attempt.status === "success" ? "ai.fallback.codex.success" : "ai.fallback.codex.error";
  }
  return attempt.status === "success" ? `ai.attempt.${attempt.stage}.success` : `ai.attempt.${attempt.stage}.error`;
}

function createConvexClient() {
  const url = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("Missing CONVEX_URL or NEXT_PUBLIC_CONVEX_URL for worker");
  }
  return new ConvexHttpClient(url);
}

async function createSocket(auth: Awaited<ReturnType<typeof useMultiFileAuthState>>["state"]) {
  let version: [number, number, number] | undefined;
  try {
    version = (await fetchLatestWaWebVersion()).version;
  } catch {
    // ignore version fetch failures and let Baileys defaults apply
  }

  const config: UserFacingSocketConfig = {
    auth,
    printQRInTerminal: true,
    browser: Browsers.macOS("Desktop"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    fireInitQueries: false,
    shouldSyncHistoryMessage: () => false,
    emitOwnEvents: false,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 20_000,
  };

  if (version) {
    config.version = version;
  }

  return makeWASocket(config);
}

async function run() {
  await acquireWorkerLock();
  const convex = createConvexClient();
  const workerId = process.env.SLM_WORKER_ID || `worker-${process.pid}`;
  const authPath = process.env.WHATSAPP_AUTH_PATH || ".wa_auth";
  let isShuttingDown = false;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // `useMultiFileAuthState` is a Baileys API, not a React hook.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { state, saveCreds } = await useMultiFileAuthState(authPath);

  const isAuthLinked = () => {
    const creds = (state as { creds?: { registered?: boolean; pairingCode?: string; me?: { id?: string } } }).creds;
    if (creds?.registered) {
      return true;
    }
    const meId = creds?.me?.id || "";
    const hasDeviceSuffix = meId.includes(":") && meId.includes("@s.whatsapp.net");
    const hasPendingPairingCode = Boolean(creds?.pairingCode);
    return hasDeviceSuffix && !hasPendingPairingCode;
  };

  const reportListener = async (listenerActive: boolean, listenerMessage: string) => {
    try {
      await convex.mutation(convexRefs.systemReportSetupListener, {
        listenerActive,
        listenerWorkerId: workerId,
        listenerMessage,
        listenerLastSeenAt: Date.now(),
        hasAuth: isAuthLinked(),
      });
    } catch {
      // best effort status sync for setup UI
    }
  };

  const invalidateCredentials = async () => {
    try {
      await rm(authPath, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  };

  const clearReconnectTimer = () => {
    if (!reconnectTimer) {
      return;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const getStatusCode = (errorLike: unknown) => {
    if (!errorLike || typeof errorLike !== "object") {
      return undefined;
    }
    const parsed = errorLike as {
      output?: { statusCode?: number };
      data?: { statusCode?: number };
      statusCode?: number;
    };
    return parsed.output?.statusCode ?? parsed.data?.statusCode ?? parsed.statusCode;
  };

  let processingOutbox = false;
  let sock = await createSocket(state);

  const reconnectDelay = (attempt: number) => {
    const base = Math.min(1000 * 2 ** Math.max(0, attempt - 1), 15_000);
    const jitter = Math.floor(Math.random() * 350);
    return base + jitter;
  };

  const scheduleReconnect = async (statusCode: number | undefined) => {
    if (isShuttingDown || reconnectTimer) {
      return;
    }

    reconnectAttempts += 1;
    const delayMs = reconnectDelay(reconnectAttempts);
    const codeText = statusCode ? `code ${statusCode}` : "unknown code";
    await reportListener(
      false,
      `Connection closed (${codeText}). Reconnecting in ${Math.ceil(delayMs / 1000)}s (attempt ${reconnectAttempts}).`,
    );

    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      if (isShuttingDown) {
        return;
      }

      try {
        const next = await createSocket(state);
        sock = next;
        attachListeners(next);
      } catch (error) {
        const err = error instanceof Error ? error.message : String(error);
        logger.error({ err }, "Failed to recreate WhatsApp socket");
        await scheduleReconnect(undefined);
      }
    }, delayMs);
  };

  const shutdown = async (code = 0, message = "Worker stopped.") => {
    isShuttingDown = true;
    clearReconnectTimer();
    await reportListener(false, message);
    releaseWorkerLockSync();
    process.exit(code);
  };

  process.once("SIGINT", () => {
    void shutdown(0, "Worker stopped.");
  });
  process.once("SIGTERM", () => {
    void shutdown(0, "Worker stopped.");
  });

  const pickEnabledAsset = async (kind: "sticker" | "meme") => {
    const assets = (await convex.query(convexRefs.mediaGetEnabledByKind, { kind }).catch(() => [])) as Array<{ _id: string }> | [];
    return assets[0]?._id;
  };

  const decideOutboundPolicy = async (args: {
    inbound: ParsedInboundMessage;
    runtimeSettings: RuntimeSettings | null;
    personalityIntensity?: number;
  }): Promise<OutboundPolicy> => {
    const text = args.inbound.text || "";
    const lowRisk = !/\b(password|otp|bank|wire|social security|medical|lawsuit|refund|contract)\b/i.test(text);
    const personalityPositive = (args.personalityIntensity ?? 0.6) >= 0.55;
    const humorAllowed = lowRisk && personalityPositive && positiveTone(text);

    if ((args.runtimeSettings?.reactionsEnabled ?? true) && looksLikeAckOnly(text)) {
      return {
        mode: "reaction_only",
        emoji: chooseReactionEmoji(text),
      };
    }

    if ((args.runtimeSettings?.stickersEnabled ?? true) && args.inbound.kind === "sticker" && humorAllowed) {
      const stickerId = await pickEnabledAsset("sticker");
      if (stickerId) {
        return {
          mode: "sticker",
          mediaAssetId: stickerId,
        };
      }
    }

    if ((args.runtimeSettings?.memesEnabled ?? true) && shouldUseMeme(text) && humorAllowed) {
      const memeId = await pickEnabledAsset("meme");
      if (memeId) {
        return {
          mode: "meme",
          mediaAssetId: memeId,
        };
      }
    }

    if ((args.runtimeSettings?.reactionsEnabled ?? true) && /\b(thanks|great|love|awesome)\b/i.test(text)) {
      return {
        mode: "reaction_plus_text",
        emoji: chooseReactionEmoji(text),
      };
    }

    return {
      mode: "text",
    };
  };

  const attachListeners = (socket: typeof sock) => {
    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("connection.update", async (update) => {
      if (socket !== sock || isShuttingDown) {
        return;
      }

      if (update.connection === "close") {
        const statusCode = getStatusCode(update.lastDisconnect?.error);
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        logger.warn({ statusCode, shouldReconnect }, "WhatsApp connection closed");

        if (!shouldReconnect) {
          clearReconnectTimer();
          reconnectAttempts = 0;
          const invalidated = await invalidateCredentials();
          await shutdown(
            1,
            invalidated
              ? "WhatsApp logged out this device. Credentials cleared. Re-link in setup."
              : "WhatsApp logged out this device. Failed to clear credentials automatically; reset credentials in setup, then re-link.",
          );
          return;
        }

        await scheduleReconnect(statusCode);
      }

      if (update.connection === "open") {
        clearReconnectTimer();
        reconnectAttempts = 0;
        logger.info("WhatsApp connection established");
        await reportListener(true, "Worker listener is active. AI reply automation is running.");
      }
    });

    socket.ev.on("messages.upsert", async (event) => {
      if (socket !== sock || event.type !== "notify") {
        return;
      }

      for (const message of event.messages) {
        if (message.key.fromMe) {
          continue;
        }

        const parsed = parseInboundMessage(message.message);
        const threadJid = getThreadJid(message.key);
        const senderJid = getSenderJid(message.key);

        if (parsed.kind === "unsupported" || !threadJid || !senderJid) {
          continue;
        }

        const messageAt = normalizeIncomingMessageTimestamp(message.messageTimestamp, Date.now());

        const ingest = (await convex.mutation(convexRefs.inboundIngest, {
          threadJid,
          senderJid,
          senderTitle: message.pushName,
          text: parsed.text,
          messageType: parsed.kind === "reaction" ? "reaction" : parsed.kind === "sticker" ? "sticker" : "text",
          reactionEmoji: parsed.kind === "reaction" ? parsed.emoji : undefined,
          reactionTargetWhatsAppMessageId: parsed.kind === "reaction" ? parsed.targetWhatsAppMessageId : undefined,
          mediaCaption: parsed.kind === "sticker" ? parsed.caption : undefined,
          isGroup: threadJid.endsWith("@g.us"),
          whatsappMessageId: message.key.id,
          messageAt,
          skipDraftGeneration: true,
        })) as {
          threadId: string;
          messageId: string;
          ignored: boolean;
          duplicate?: boolean;
          stale?: boolean;
          reactionTargetMessageId?: string;
        };

        if (ingest.duplicate) {
          logger.info({ threadJid, whatsappMessageId: message.key.id }, "Inbound duplicate ignored");
          continue;
        }

        if (ingest.stale) {
          logger.info(
            { threadJid, whatsappMessageId: message.key.id, messageAt },
            "Inbound stale message ignored for auto-reply",
          );
          continue;
        }

        if (ingest.ignored) {
          logger.info({ threadJid }, "Inbound ignored by rules");
          continue;
        }

        if (parsed.kind === "reaction") {
          continue;
        }

        const threadContext = (await convex.query(convexRefs.threadGet, {
          threadId: ingest.threadId,
        })) as
          | {
              messages: Array<{ direction: "inbound" | "outbound"; text: string; messageType?: string }>;
              grounding?: { myName?: string; theirName?: string; autoAliases?: string[]; vibeNotes?: string } | null;
              memory?: { styleNotes?: string[] } | null;
            }
          | null;

        const runtimeSettings = (await convex.query(convexRefs.settingsGet, {})) as RuntimeSettings | null;
        const historyLimit = Math.round(clamp(runtimeSettings?.aiHistoryLineLimit ?? 12, 4, 40));
        const historyLines = (threadContext?.messages || []).slice(-historyLimit).map((m) => {
          return `${m.direction === "inbound" ? "Them" : "Me"}: ${m.text}`;
        });

        const styleHints = threadContext?.memory?.styleNotes || [];
        const styleProfile = (await convex.query(convexRefs.styleGetProfile, {})) as
          | {
              mimicryLevel?: number;
              commonPhrases?: string[];
              punctuationStyle?: string[];
              humorNotes?: string[];
              spellingNotes?: string[];
            }
          | null;
        const personalitySetting = (await convex.query(convexRefs.personalityGetThreadSetting, {
          threadId: ingest.threadId,
        })) as
          | {
              profileSlug?: string;
              intensity?: number;
              customPrompt?: string;
              profile?: {
                slug?: string;
                name?: string;
                description?: string;
                prompt?: string;
              } | null;
            }
          | null;

        const outboundPolicy = await decideOutboundPolicy({
          inbound: parsed,
          runtimeSettings,
          personalityIntensity: personalitySetting?.intensity,
        });

        const shouldGenerateAiText = outboundPolicy.mode === "text" || outboundPolicy.mode === "reaction_plus_text" || outboundPolicy.mode === "meme";
        const inboundTextForAi =
          parsed.kind === "sticker"
            ? `${parsed.text}${parsed.caption ? ` (${parsed.caption})` : ""}`
            : parsed.text;

        const ai = shouldGenerateAiText
          ? await generateReplyWithFallback({
              inboundText: inboundTextForAi,
              historyLines,
              styleHints,
              styleProfile: styleProfile || undefined,
              personality: personalitySetting
                ? {
                    profileSlug: personalitySetting.profileSlug || personalitySetting.profile?.slug,
                    profileName: personalitySetting.profile?.name,
                    profileDescription: personalitySetting.profile?.description,
                    profilePrompt: personalitySetting.profile?.prompt,
                    intensity: personalitySetting.intensity,
                    customPrompt: personalitySetting.customPrompt || "",
                  }
                : undefined,
              grounding: threadContext?.grounding
                ? {
                    myName: threadContext.grounding.myName,
                    theirName: threadContext.grounding.theirName,
                    autoAliases: threadContext.grounding.autoAliases || [],
                    vibeNotes: threadContext.grounding.vibeNotes || "",
                  }
                : undefined,
              runtime: {
                temperature: runtimeSettings?.aiTemperature,
                maxOutputTokens: runtimeSettings?.aiMaxOutputTokens,
                maxReplyChars: runtimeSettings?.aiMaxReplyChars,
                historyLineLimit: runtimeSettings?.aiHistoryLineLimit,
                fallbackMode: runtimeSettings?.aiFallbackMode,
                replyPolicyInstruction: runtimeSettings?.aiReplyPolicy || "",
                systemInstruction: runtimeSettings?.aiSystemInstruction || "",
                delayMinMs: runtimeSettings?.humanDelayMinMs,
                delayMaxMs: runtimeSettings?.humanDelayMaxMs,
                typingMinMs: runtimeSettings?.humanTypingMinMs,
                typingMaxMs: runtimeSettings?.humanTypingMaxMs,
              },
            })
          : null;

        if (ai) {
          await convex
            .mutation(convexRefs.systemRecordEvent, {
              source: "ai",
              eventType: "ai.reply.pipeline",
              threadId: ingest.threadId,
              detail: `Generated ${ai.attempts.length} AI pipeline attempt(s) for inbound message.`,
            })
            .catch(() => undefined);
          for (let index = 0; index < ai.attempts.length; index += 1) {
            const attempt = ai.attempts[index];
            const label = attemptStageLabel(attempt.stage);
            const detail = attempt.error
              ? `Attempt ${index + 1}/${ai.attempts.length} · ${label} · ${attempt.model} · ${attempt.latencyMs}ms · ${attempt.error.slice(0, 220)}`
              : `Attempt ${index + 1}/${ai.attempts.length} · ${label} · ${attempt.model} · ${attempt.latencyMs}ms`;

            await convex
              .mutation(convexRefs.systemRecordProviderRun, {
                threadId: ingest.threadId,
                provider: attempt.provider,
                model: attempt.model,
                latencyMs: attempt.latencyMs,
                status: attempt.status,
                ...(attempt.error ? { error: attempt.error.slice(0, 300) } : {}),
              })
              .catch(() => undefined);

            await convex
              .mutation(convexRefs.systemRecordEvent, {
                source: "ai",
                eventType: attemptEventType(attempt),
                threadId: ingest.threadId,
                detail,
              })
              .catch(() => undefined);
          }

          if (ai.guardrailBlocked) {
            await convex
              .mutation(convexRefs.systemRecordEvent, {
                source: "ai",
                eventType: "ai.reply.blocked",
                threadId: ingest.threadId,
                detail: ai.guardrailReason || "Blocked by guardrail",
              })
              .catch(() => undefined);
            await convex.mutation(convexRefs.draftCreateGuardrailHold, {
              threadId: ingest.threadId,
              sourceMessageId: ingest.messageId,
              reason: ai.guardrailReason || "Blocked by guardrail",
            });
            continue;
          }
        }

        const textForDraft =
          outboundPolicy.mode === "reaction_only"
            ? `React with ${outboundPolicy.emoji}`
            : outboundPolicy.mode === "sticker"
              ? "Send sticker response"
              : normalizeOutboundText(ai?.text || "All good.");
        const timing = estimateDelayAndTyping(textForDraft, {
          delayMinMs: runtimeSettings?.humanDelayMinMs,
          delayMaxMs: runtimeSettings?.humanDelayMaxMs,
          typingMinMs: runtimeSettings?.humanTypingMinMs,
          typingMaxMs: runtimeSettings?.humanTypingMaxMs,
        });
        const primaryConfidence = clamp(runtimeSettings?.aiPrimaryConfidence ?? 0.78, 0.01, 1);
        const fallbackConfidence = clamp(runtimeSettings?.aiFallbackConfidence ?? 0.58, 0.01, 1);
        const sendKind =
          outboundPolicy.mode === "reaction_only"
            ? "reaction"
            : outboundPolicy.mode === "sticker"
              ? "sticker"
              : outboundPolicy.mode === "meme"
                ? "meme"
                : "text";

        const draftId = (await convex.mutation(convexRefs.draftSaveGenerated, {
          threadId: ingest.threadId,
          sourceMessageId: ingest.messageId,
          text: textForDraft,
          provider: ai?.provider || "heuristic",
          confidence: ai ? (ai.provider === "heuristic" ? fallbackConfidence : primaryConfidence) : fallbackConfidence,
          delayMs: timing.delayMs,
          typingMs: timing.typingMs,
          reason: "Generated by worker AI pipeline",
          sendKind,
          reactionEmoji:
            outboundPolicy.mode === "reaction_only" || outboundPolicy.mode === "reaction_plus_text" ? outboundPolicy.emoji : undefined,
          reactionTargetMessageId:
            outboundPolicy.mode === "reaction_only" || outboundPolicy.mode === "reaction_plus_text"
              ? (ingest.messageId as Id<"messages">)
              : undefined,
          mediaAssetId:
            outboundPolicy.mode === "sticker" || outboundPolicy.mode === "meme"
              ? (outboundPolicy.mediaAssetId as Id<"mediaAssets">)
              : undefined,
          mediaCaption: outboundPolicy.mode === "meme" ? textForDraft : undefined,
        })) as string;

        await convex
          .mutation(convexRefs.systemRecordEvent, {
            source: "ai",
            eventType: "ai.reply.generated",
            threadId: ingest.threadId,
            detail: ai
              ? `Reply generated via ${ai.provider}/${ai.model} in ${ai.latencyMs}ms.`
              : `Reply generated via policy mode ${outboundPolicy.mode}.`,
          })
          .catch(() => undefined);

        const health = (await convex.query(convexRefs.systemHealth, {})) as {
          config?: { autonomyPaused?: boolean };
        };

        if (!health?.config?.autonomyPaused) {
          await convex.mutation(convexRefs.draftApprove, {
            draftId,
          });
        }
      }
    });
  };

  await reportListener(false, "Worker starting WhatsApp listener...");
  attachListeners(sock);

  const hydrateAiOutreach = async (
    item: {
      outboxId: string;
      threadId: string;
      jid: string;
      messageText: string;
      typingMs: number;
      sendKind: "text" | "reaction" | "sticker" | "meme";
      reactionEmoji?: string;
      reactionTargetWhatsAppMessageId?: string;
      preReactionEmoji?: string;
      mediaAssetId?: string;
      mediaCaption?: string;
    },
    runtimeSettings: RuntimeSettings | null,
  ) => {
    if (item.messageText !== AI_OUTREACH_PLACEHOLDER) {
      return {
        ...item,
        messageText: item.messageText,
        typingMs: item.typingMs,
      };
    }

    const threadContext = (await convex.query(convexRefs.threadGet, {
      threadId: item.threadId,
    })) as
      | {
          thread: { title?: string; jid: string };
          messages: Array<{ direction: "inbound" | "outbound"; text: string }>;
          grounding?: { myName?: string; theirName?: string; autoAliases?: string[]; vibeNotes?: string } | null;
          memory?: { summary?: string; styleNotes?: string[] } | null;
        }
      | null;

    const historyLimit = Math.round(clamp(runtimeSettings?.aiHistoryLineLimit ?? 12, 4, 40));
    const historyLines = (threadContext?.messages || []).slice(-historyLimit).map((m) => {
      return `${m.direction === "inbound" ? "Them" : "Me"}: ${m.text}`;
    });

    const styleHints = threadContext?.memory?.styleNotes || [];
    const styleProfile = (await convex.query(convexRefs.styleGetProfile, {})) as
      | {
          mimicryLevel?: number;
          commonPhrases?: string[];
          punctuationStyle?: string[];
          humorNotes?: string[];
          spellingNotes?: string[];
        }
      | null;

    const personalitySetting = (await convex.query(convexRefs.personalityGetThreadSetting, {
      threadId: item.threadId,
    })) as
      | {
          profileSlug?: string;
          intensity?: number;
          customPrompt?: string;
          profile?: {
            slug?: string;
            name?: string;
            description?: string;
            prompt?: string;
          } | null;
        }
      | null;

    const memorySummary = threadContext?.memory?.summary ? `Memory summary: ${threadContext.memory.summary}` : "";
    const contactName = threadContext?.thread?.title?.split(/\s+/)[0] || "there";
    const promptSeed = [
      "Proactively start a fresh check-in conversation with this contact now.",
      "Use previous chat context so the opener feels natural, specific, and warm.",
      "Keep it to 1-2 short sentences, avoid sounding robotic, and include exactly one gentle question.",
      memorySummary,
      `Contact first name: ${contactName}`,
    ]
      .filter(Boolean)
      .join("\n");

    const ai = await generateReplyWithFallback({
      inboundText: promptSeed,
      historyLines,
      styleHints,
      styleProfile: styleProfile || undefined,
      personality: personalitySetting
        ? {
            profileSlug: personalitySetting.profileSlug || personalitySetting.profile?.slug,
            profileName: personalitySetting.profile?.name,
            profileDescription: personalitySetting.profile?.description,
            profilePrompt: personalitySetting.profile?.prompt,
            intensity: personalitySetting.intensity,
            customPrompt: personalitySetting.customPrompt || "",
          }
        : undefined,
      grounding: threadContext?.grounding
        ? {
            myName: threadContext.grounding.myName,
            theirName: threadContext.grounding.theirName,
            autoAliases: threadContext.grounding.autoAliases || [],
            vibeNotes: threadContext.grounding.vibeNotes || "",
          }
        : undefined,
      runtime: {
        temperature: runtimeSettings?.aiTemperature,
        maxOutputTokens: runtimeSettings?.aiMaxOutputTokens,
        maxReplyChars: runtimeSettings?.aiMaxReplyChars,
        historyLineLimit: runtimeSettings?.aiHistoryLineLimit,
        fallbackMode: runtimeSettings?.aiFallbackMode,
        replyPolicyInstruction: runtimeSettings?.aiReplyPolicy || "",
        systemInstruction: runtimeSettings?.aiSystemInstruction || "",
        delayMinMs: runtimeSettings?.humanDelayMinMs,
        delayMaxMs: runtimeSettings?.humanDelayMaxMs,
        typingMinMs: runtimeSettings?.humanTypingMinMs,
        typingMaxMs: runtimeSettings?.humanTypingMaxMs,
      },
    });

    for (let index = 0; index < ai.attempts.length; index += 1) {
      const attempt = ai.attempts[index];
      const label = attemptStageLabel(attempt.stage);
      const detail = attempt.error
        ? `Outreach attempt ${index + 1}/${ai.attempts.length} · ${label} · ${attempt.model} · ${attempt.latencyMs}ms · ${attempt.error.slice(0, 220)}`
        : `Outreach attempt ${index + 1}/${ai.attempts.length} · ${label} · ${attempt.model} · ${attempt.latencyMs}ms`;

      await convex
        .mutation(convexRefs.systemRecordProviderRun, {
          threadId: item.threadId,
          provider: attempt.provider,
          model: attempt.model,
          latencyMs: attempt.latencyMs,
          status: attempt.status,
          ...(attempt.error ? { error: attempt.error.slice(0, 300) } : {}),
        })
        .catch(() => undefined);

      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "ai",
          eventType: `outreach.${attemptEventType(attempt)}`,
          threadId: item.threadId,
          detail,
        })
        .catch(() => undefined);
    }

    if (ai.guardrailBlocked && runtimeSettings?.aiFallbackMode === "azure_only") {
      throw new Error(ai.guardrailReason || "Azure-only mode blocked outreach fallback.");
    }

    const fallbackText = `Hey ${contactName}, just checking in. How is your day going?`;
    const safeText = normalizeOutboundText(ai.guardrailBlocked ? fallbackText : ai.text);
    const timing = estimateDelayAndTyping(safeText, {
      delayMinMs: runtimeSettings?.humanDelayMinMs,
      delayMaxMs: runtimeSettings?.humanDelayMaxMs,
      typingMinMs: runtimeSettings?.humanTypingMinMs,
      typingMaxMs: runtimeSettings?.humanTypingMaxMs,
    });

    const primaryConfidence = clamp(runtimeSettings?.aiPrimaryConfidence ?? 0.78, 0.01, 1);
    const fallbackConfidence = clamp(runtimeSettings?.aiFallbackConfidence ?? 0.58, 0.01, 1);
    const provider = ai.guardrailBlocked ? "heuristic" : ai.provider;
    const confidence = provider === "heuristic" ? fallbackConfidence : primaryConfidence;

    await convex.mutation(convexRefs.outboxHydrateAiOutreach, {
      outboxId: item.outboxId,
      text: safeText,
      provider,
      confidence,
      typingMs: timing.typingMs,
    });

    return {
      ...item,
      messageText: safeText,
      typingMs: timing.typingMs,
    };
  };

  const fetchMediaAssetBuffer = async (assetId: string) => {
    const asset = (await convex.query(convexRefs.mediaGetAssetDownloadUrl, {
      assetId,
    })) as null | { url: string };
    if (!asset?.url) {
      throw new Error(`Media asset unavailable: ${assetId}`);
    }
    const response = await fetch(asset.url);
    if (!response.ok) {
      throw new Error(`Failed to download media asset ${assetId}: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      throw new Error(`Media asset ${assetId} is empty.`);
    }
    return buffer;
  };

  const pollOutbox = async () => {
    if (processingOutbox) {
      return;
    }

    processingOutbox = true;
    try {
      const runtimeSettings = (await convex.query(convexRefs.settingsGet, {})) as RuntimeSettings | null;
      const claimLimit = Math.round(clamp(runtimeSettings?.outboxClaimLimit ?? 8, 1, 20));
      const claimed = (await convex.mutation(convexRefs.outboxClaimDue, {
        workerId,
        limit: claimLimit,
      })) as Array<{
        outboxId: string;
        threadId: string;
        jid: string;
        messageText: string;
        typingMs: number;
        provider: "azure" | "codex" | "heuristic";
        sendKind: "text" | "reaction" | "sticker" | "meme";
        reactionEmoji?: string;
        reactionTargetWhatsAppMessageId?: string;
        preReactionEmoji?: string;
        mediaAssetId?: string;
        mediaCaption?: string;
      }>;

      for (const item of claimed) {
        try {
          if (
            runtimeSettings?.aiFallbackMode === "azure_only" &&
            item.provider !== "azure" &&
            (item.sendKind === "text" || item.sendKind === "meme") &&
            item.messageText !== AI_OUTREACH_PLACEHOLDER
          ) {
            await convex.mutation(convexRefs.outboxMarkFailed, {
              outboxId: item.outboxId,
              error: `Blocked by Azure-only mode: non-Azure outbox item (${item.provider}).`,
            });
            continue;
          }

          const hydrated = await hydrateAiOutreach(item, runtimeSettings);

          if (hydrated.reactionEmoji && hydrated.reactionTargetWhatsAppMessageId && hydrated.sendKind === "text") {
            await sock.sendMessage(item.jid, {
              react: {
                text: hydrated.reactionEmoji,
                key: {
                  remoteJid: item.jid,
                  id: hydrated.reactionTargetWhatsAppMessageId,
                  fromMe: false,
                },
              },
            });
          }

          let sent: { key?: { id?: string | null } } | undefined;
          if (hydrated.sendKind === "reaction") {
            if (!hydrated.reactionEmoji || !hydrated.reactionTargetWhatsAppMessageId) {
              throw new Error("Reaction outbox item missing emoji or target message id.");
            }
            sent = await sock.sendMessage(item.jid, {
              react: {
                text: hydrated.reactionEmoji,
                key: {
                  remoteJid: item.jid,
                  id: hydrated.reactionTargetWhatsAppMessageId,
                  fromMe: false,
                },
              },
            });
          } else if (hydrated.sendKind === "sticker") {
            if (!hydrated.mediaAssetId) {
              throw new Error("Sticker outbox item missing media asset id.");
            }
            const stickerBuffer = await fetchMediaAssetBuffer(hydrated.mediaAssetId);
            sent = await sock.sendMessage(item.jid, {
              sticker: stickerBuffer,
            });
          } else if (hydrated.sendKind === "meme") {
            if (!hydrated.mediaAssetId) {
              throw new Error("Meme outbox item missing media asset id.");
            }
            await sock.sendPresenceUpdate("composing", item.jid);
            await convex.mutation(convexRefs.outboxMarkTyping, { outboxId: item.outboxId });
            await sleep(hydrated.typingMs);
            const memeBuffer = await fetchMediaAssetBuffer(hydrated.mediaAssetId);
            sent = await sock.sendMessage(item.jid, {
              image: memeBuffer,
              caption: hydrated.mediaCaption || hydrated.messageText,
            });
            await sock.sendPresenceUpdate("paused", item.jid);
          } else {
            await sock.sendPresenceUpdate("composing", item.jid);
            await convex.mutation(convexRefs.outboxMarkTyping, { outboxId: item.outboxId });
            await sleep(hydrated.typingMs);
            sent = await sock.sendMessage(item.jid, { text: hydrated.messageText });
            await sock.sendPresenceUpdate("paused", item.jid);
          }

          await convex.mutation(convexRefs.outboxMarkSent, {
            outboxId: item.outboxId,
            whatsappMessageId: sent?.key?.id || undefined,
          });
        } catch (error) {
          const err = error instanceof Error ? error.message : String(error);
          await convex.mutation(convexRefs.outboxMarkFailed, {
            outboxId: item.outboxId,
            error: err,
          });
        }
      }
    } finally {
      processingOutbox = false;
    }
  };

  const startupSettings = (await convex.query(convexRefs.settingsGet, {})) as RuntimeSettings | null;
  const intervalMs = Math.round(
    clamp(startupSettings?.outboxPollMs ?? Number(process.env.SLM_OUTBOX_POLL_MS || 3000), 500, 60_000),
  );
  setInterval(() => {
    void pollOutbox();
  }, intervalMs);

  logger.info({ workerId, intervalMs }, "Social Life Manager worker started");
}

void run().catch((error) => {
  releaseWorkerLockSync();
  logger.error({ err: error }, "Worker crashed");
  process.exit(1);
});
