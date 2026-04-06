import makeWASocket, { Browsers, DisconnectReason, fetchLatestWaWebVersion, useMultiFileAuthState, type UserFacingSocketConfig } from "baileys";
import { rm } from "node:fs/promises";
import pino from "pino";
import { ConvexHttpClient } from "convex/browser";
import { convexRefs } from "../lib/convex-refs";
import { acquireWorkerLock, releaseWorkerLockSync } from "../lib/runtime/worker-lock";
import { generateReplyWithFallback, estimateDelayAndTyping } from "./ai";
import { extractTextFromMessage, getSenderJid, getThreadJid } from "./whatsapp";

const logger = pino({
  name: "slm-worker",
  level: process.env.LOG_LEVEL || "info",
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

        const text = extractTextFromMessage(message.message);
        const threadJid = getThreadJid(message.key);
        const senderJid = getSenderJid(message.key);

        if (!text || !threadJid || !senderJid) {
          continue;
        }

        const ingest = (await convex.mutation(convexRefs.inboundIngest, {
          threadJid,
          senderJid,
          senderTitle: message.pushName,
          text,
          isGroup: threadJid.endsWith("@g.us"),
          whatsappMessageId: message.key.id,
          messageAt: Number(message.messageTimestamp || Date.now()),
          skipDraftGeneration: true,
        })) as {
          threadId: string;
          messageId: string;
          ignored: boolean;
          duplicate?: boolean;
        };

        if (ingest.duplicate) {
          logger.info({ threadJid, whatsappMessageId: message.key.id }, "Inbound duplicate ignored");
          continue;
        }

        if (ingest.ignored) {
          logger.info({ threadJid }, "Inbound ignored by rules");
          continue;
        }

        const threadContext = (await convex.query(convexRefs.threadGet, {
          threadId: ingest.threadId,
        })) as
          | {
              messages: Array<{ direction: "inbound" | "outbound"; text: string }>;
              memory?: { styleNotes?: string[] } | null;
            }
          | null;

        const historyLines = (threadContext?.messages || []).slice(-12).map((m) => {
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

        const ai = await generateReplyWithFallback({
          inboundText: text,
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
        });

        if (ai.guardrailBlocked) {
          await convex.mutation(convexRefs.draftCreateGuardrailHold, {
            threadId: ingest.threadId,
            sourceMessageId: ingest.messageId,
            reason: ai.guardrailReason || "Blocked by guardrail",
          });
          continue;
        }

        const timing = estimateDelayAndTyping(ai.text);
        const draftId = (await convex.mutation(convexRefs.draftSaveGenerated, {
          threadId: ingest.threadId,
          sourceMessageId: ingest.messageId,
          text: ai.text,
          provider: ai.provider,
          confidence: ai.provider === "heuristic" ? 0.58 : 0.78,
          delayMs: timing.delayMs,
          typingMs: timing.typingMs,
          reason: "Generated by worker AI pipeline",
        })) as string;

        await convex.mutation(convexRefs.systemRecordProviderRun, {
          threadId: ingest.threadId,
          draftId,
          provider: ai.provider,
          model: ai.model,
          latencyMs: ai.latencyMs,
          status: "success",
        });

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

  const pollOutbox = async () => {
    if (processingOutbox) {
      return;
    }

    processingOutbox = true;
    try {
      const claimed = (await convex.mutation(convexRefs.outboxClaimDue, {
        workerId,
        limit: 8,
      })) as Array<{
        outboxId: string;
        jid: string;
        messageText: string;
        typingMs: number;
      }>;

      for (const item of claimed) {
        try {
          await sock.sendPresenceUpdate("composing", item.jid);
          await convex.mutation(convexRefs.outboxMarkTyping, { outboxId: item.outboxId });
          await sleep(item.typingMs);
          const sent = await sock.sendMessage(item.jid, { text: item.messageText });
          await sock.sendPresenceUpdate("paused", item.jid);

          await convex.mutation(convexRefs.outboxMarkSent, {
            outboxId: item.outboxId,
            whatsappMessageId: sent?.key?.id,
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

  const intervalMs = Number(process.env.SLM_OUTBOX_POLL_MS || 3000);
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
