import { createHash } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import type { Message } from "@photon-ai/imessage-kit";
import type { Id } from "../../convex/_generated/dataModel";
import { convexRefs } from "../lib/convex-refs";
import { acquireWorkerLock, releaseWorkerLockSync } from "../lib/runtime/worker-lock";
import pino from "pino";

type OutboxClaimedItem = {
  outboxId: string;
  threadId: string;
  jid: string;
  messageText: string;
  typingMs: number;
  messageProvider: "whatsapp" | "instagram" | "imessage" | "telegram";
  provider: "azure" | "codex" | "heuristic";
  sendKind: "text" | "reaction" | "sticker" | "meme" | "voice_note";
  isStatusPost?: boolean;
};

const logger = pino({
  name: "slm-imessage-worker",
  level: process.env.LOG_LEVEL || "info",
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(value, max));
}

function connectorTokenHash() {
  const token = process.env.ODOGWU_SERVICE_MODE === "self_hosted" ? "" : (process.env.ODOGWU_CONNECTOR_TOKEN || "").trim();
  return token ? createHash("sha256").update(token).digest("hex") : "";
}

function tenantConnectorArgs() {
  const tenantId = process.env.ODOGWU_SERVICE_MODE === "self_hosted" ? "" : (process.env.ODOGWU_TENANT_ID || "").trim();
  const tokenHash = connectorTokenHash();
  return tenantId && tokenHash
    ? {
        tenantId,
        connectorTokenHash: tokenHash,
      }
    : {};
}

function connectorDeviceId(workerId: string) {
  return (process.env.ODOGWU_DEVICE_ID || workerId).trim();
}

export function normalizeIMessageText(message: Message) {
  const text = (message.text || "").trim();
  if (text) {
    return text;
  }
  const attachments = message.attachments || [];
  if (attachments.some((attachment) => attachment.mimeType.startsWith("image/"))) {
    return "[Image]";
  }
  if (attachments.some((attachment) => attachment.mimeType.startsWith("video/"))) {
    return "[Video]";
  }
  if (attachments.some((attachment) => attachment.mimeType.startsWith("audio/"))) {
    return "[Audio]";
  }
  if (attachments.length) {
    return "[Attachment]";
  }
  if (message.reaction?.kind) {
    return message.reaction.emoji ? `Reacted with ${message.reaction.emoji}` : `Reacted with ${message.reaction.kind}`;
  }
  return "";
}

export function normalizeIMessageType(message: Message): "text" | "reaction" | "image" | "video" | "audio" | "document" {
  if (message.reaction?.kind) {
    return "reaction";
  }
  const attachments = message.attachments || [];
  if (attachments.some((attachment) => attachment.mimeType.startsWith("image/"))) {
    return "image";
  }
  if (attachments.some((attachment) => attachment.mimeType.startsWith("video/"))) {
    return "video";
  }
  if (attachments.some((attachment) => attachment.mimeType.startsWith("audio/"))) {
    return "audio";
  }
  if (attachments.length) {
    return "document";
  }
  return "text";
}

export function iMessageAtMs(message: Message) {
  const raw = message.createdAt instanceof Date ? message.createdAt.getTime() : Date.now();
  return Number.isFinite(raw) && raw > 0 ? raw : Date.now();
}

export function iMessageThreadJid(message: Message) {
  return message.chatId || message.participant || "";
}

export function iMessageSenderJid(message: Message) {
  return message.participant || message.chatId || "imessage:unknown";
}

export function isIMessagePlatformSupported(platform: NodeJS.Platform = process.platform) {
  return platform === "darwin";
}

async function createConvexClient() {
  const url = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("Missing CONVEX_URL or NEXT_PUBLIC_CONVEX_URL for iMessage worker.");
  }
  return new ConvexHttpClient(url);
}

async function reportSetupStatus(convex: ConvexHttpClient, status: "starting" | "connected" | "error", message: string) {
  await convex
    .mutation(convexRefs.systemUpsertSetupStatus, {
      ...tenantConnectorArgs(),
      provider: "imessage",
      status,
      mode: "local",
      message,
      hasAuth: status === "connected",
      updatedAt: Date.now(),
    })
    .catch(() => undefined);
}

async function reportListener(convex: ConvexHttpClient, workerId: string, listenerActive: boolean, listenerMessage: string) {
  const hasAuth = listenerActive;
  await convex
    .mutation(convexRefs.systemReportSetupListener, {
      ...tenantConnectorArgs(),
      provider: "imessage",
      listenerActive,
      listenerWorkerId: workerId,
      listenerMessage,
      listenerLastSeenAt: Date.now(),
      hasAuth,
    })
    .catch(() => undefined);

  if (!listenerActive) {
    await convex
      .mutation(convexRefs.connectedAccountsMarkDisconnectedFromConnector, {
        ...tenantConnectorArgs(),
        deviceId: connectorDeviceId(workerId),
        provider: "imessage",
        authState: "unknown",
        lastSeenAt: Date.now(),
      })
      .catch(() => undefined);
    return;
  }

  await convex
    .mutation(convexRefs.connectedAccountsUpsertFromConnector, {
      ...tenantConnectorArgs(),
      deviceId: connectorDeviceId(workerId),
      provider: "imessage",
      providerAccountId: "imessage:local-messages",
      accountLabel: "Messages on this Mac",
      displayName: "iMessage",
      authState: "connected",
      lastSeenAt: Date.now(),
    })
    .catch(() => undefined);
}

async function ingestMessage(convex: ConvexHttpClient, message: Message) {
  const jid = iMessageThreadJid(message);
  const text = normalizeIMessageText(message);
  if (!jid || !text) {
    return;
  }

  const messageType = normalizeIMessageType(message);
  await convex.mutation(convexRefs.inboundIngest, {
    ...tenantConnectorArgs(),
    provider: "imessage",
    threadJid: jid,
    senderJid: iMessageSenderJid(message),
    senderTitle: message.participant || undefined,
    text,
    messageType,
    reactionEmoji: message.reaction?.emoji || undefined,
    isGroup: message.chatKind === "group",
    threadKind: message.chatKind === "group" ? "group" : "direct",
    providerMessageId: message.id,
    messageAt: iMessageAtMs(message),
  });
}

async function processOutboxItem(convex: ConvexHttpClient, sdk: { send(request: { to: string; text?: string }): Promise<void> }, item: OutboxClaimedItem) {
  if (item.sendKind !== "text") {
    await convex.mutation(convexRefs.outboxMarkFailed, {
      ...tenantConnectorArgs(),
      outboxId: item.outboxId as Id<"outbox">,
      error: `iMessage worker only supports text sends for now; got ${item.sendKind}.`,
    });
    return;
  }

  if (item.isStatusPost) {
    await convex.mutation(convexRefs.outboxMarkFailed, {
      ...tenantConnectorArgs(),
      outboxId: item.outboxId as Id<"outbox">,
      error: "iMessage does not support status posts.",
    });
    return;
  }

  await convex.mutation(convexRefs.outboxMarkTyping, {
    ...tenantConnectorArgs(),
    outboxId: item.outboxId as Id<"outbox">,
  });
  await sleep(clamp(item.typingMs || 0, 0, 45_000));
  const disposition = (await convex.query(convexRefs.outboxGetSendDisposition, {
    ...tenantConnectorArgs(),
    outboxId: item.outboxId as Id<"outbox">,
  })) as { allowed?: boolean; reason?: string };
  if (!disposition.allowed) {
    await convex.mutation(convexRefs.outboxMarkFailed, {
      ...tenantConnectorArgs(),
      outboxId: item.outboxId as Id<"outbox">,
      error: `Suppressed: ${disposition.reason || "send disposition blocked"}`,
    });
    return;
  }

  await sdk.send({ to: item.jid, text: item.messageText });
  await convex.mutation(convexRefs.outboxMarkSent, {
    ...tenantConnectorArgs(),
    outboxId: item.outboxId as Id<"outbox">,
    messageProvider: "imessage",
  });
}

async function pollOutbox(convex: ConvexHttpClient, sdk: { send(request: { to: string; text?: string }): Promise<void> }, workerId: string) {
  const claimed = (await convex.mutation(convexRefs.outboxClaimDue, {
    ...tenantConnectorArgs(),
    workerId,
    messageProvider: "imessage",
    limit: 1,
    leaseMs: 3 * 60_000,
  })) as OutboxClaimedItem[];

  for (const item of claimed) {
    try {
      await processOutboxItem(convex, sdk, item);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await convex
        .mutation(convexRefs.outboxMarkFailed, {
          ...tenantConnectorArgs(),
          outboxId: item.outboxId as Id<"outbox">,
          error: detail.slice(0, 300),
        })
        .catch(() => undefined);
    }
  }
}

async function run() {
  await acquireWorkerLock("imessage");
  const convex = await createConvexClient();
  const workerId = process.env.SLM_IMESSAGE_WORKER_ID || process.env.SLM_WORKER_ID || `imessage-worker-${process.pid}`;
  const selfHosted = process.env.ODOGWU_SERVICE_MODE === "self_hosted";
  const tenantId = selfHosted ? "" : (process.env.ODOGWU_TENANT_ID || "").trim();
  const tokenHash = connectorTokenHash();

  if (!selfHosted) {
    if (!tenantId || !tokenHash) {
      logger.warn("Hosted worker missing tenant connector credentials; exiting before connecting iMessage.");
      return;
    }
    const verifiedConnector = await convex
      .mutation(convexRefs.tenantAccountsVerifyConnectorToken, {
        tokenHash,
        provider: "imessage",
      })
      .catch(() => null);
    if (!verifiedConnector) {
      logger.warn("Hosted worker connector is inactive, billing expired, or iMessage is disabled for this tenant plan.");
      return;
    }
  }

  if (!isIMessagePlatformSupported()) {
    const message = "iMessage support requires macOS and the local Messages database.";
    logger.warn({ platform: process.platform }, message);
    await reportSetupStatus(convex, "error", message);
    return;
  }

  await reportSetupStatus(convex, "starting", "Starting local iMessage worker...");

  const { IMessageSDK } = await import("@photon-ai/imessage-kit");
  const sdk = new IMessageSDK({
    debug: process.env.SLM_IMESSAGE_DEBUG === "1",
  });

  const outboxPollMs = Math.round(clamp(Number(process.env.SLM_IMESSAGE_OUTBOX_POLL_MS || 4_000), 800, 60_000));

  await sdk.startWatching({
    onIncomingMessage: async (message) => {
      await ingestMessage(convex, message).catch((error) => {
        const detail = error instanceof Error ? error.message : String(error);
        logger.warn({ err: detail, providerMessageId: message.id }, "Failed to ingest iMessage");
      });
    },
    onError: (error) => {
      logger.warn({ err: error.message }, "iMessage watcher error");
    },
  });

  await reportSetupStatus(convex, "connected", "iMessage worker is watching Messages on this Mac.");
  await reportListener(convex, workerId, true, "iMessage worker listener is online.");

  const outboxTimer = setInterval(() => {
    void pollOutbox(convex, sdk, workerId).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      logger.warn({ err: detail }, "iMessage outbox poll failed");
    });
  }, outboxPollMs);

  const heartbeatTimer = setInterval(() => {
    void reportListener(convex, workerId, true, "iMessage worker listener is online.");
  }, 60_000);

  const shutdown = async () => {
    clearInterval(outboxTimer);
    clearInterval(heartbeatTimer);
    await reportListener(convex, workerId, false, "iMessage worker listener is offline.");
    await sdk.close().catch(() => undefined);
    releaseWorkerLockSync("imessage");
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });

  logger.info({ workerId, outboxPollMs }, "iMessage worker started");
  await new Promise<void>(() => undefined);
}

const shouldBootWorkerProcess = Boolean(process.argv[1] && /imessage\.(ts|js)$/.test(process.argv[1]));

if (shouldBootWorkerProcess) {
  run().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error({ err: detail }, "iMessage worker crashed");
    releaseWorkerLockSync("imessage");
    process.exitCode = 1;
  });
}
