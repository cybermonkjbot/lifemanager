import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import bigInt from "big-integer";
import { ConvexHttpClient } from "convex/browser";
import { Api, TelegramClient } from "telegram";
import { NewMessage, type NewMessageEvent } from "telegram/events";
import { StringSession } from "telegram/sessions";
import type { EntityLike } from "telegram/define";
import type { Id } from "../../convex/_generated/dataModel";
import { convexRefs } from "../lib/convex-refs";
import { getRuntimeDataPath } from "../lib/runtime/paths";
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

type TelegramSessionFile = {
  apiId: number;
  apiHash: string;
  phoneNumber: string;
  sessionString: string;
  updatedAt: number;
};

const logger = pino({
  name: "slm-telegram-worker",
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

export async function readTelegramSession(): Promise<TelegramSessionFile | null> {
  const envApiId = Math.round(Number(process.env.SLM_TELEGRAM_API_ID || 0));
  const envApiHash = (process.env.SLM_TELEGRAM_API_HASH || "").trim();
  const envSession = (process.env.SLM_TELEGRAM_SESSION_STRING || "").trim();
  if (envApiId && envApiHash && envSession) {
    return {
      apiId: envApiId,
      apiHash: envApiHash,
      phoneNumber: (process.env.SLM_TELEGRAM_PHONE_NUMBER || "").trim(),
      sessionString: envSession,
      updatedAt: Date.now(),
    };
  }

  try {
    return JSON.parse(await readFile(getRuntimeDataPath("telegram-session.json"), "utf8")) as TelegramSessionFile;
  } catch {
    return null;
  }
}

export function peerToJid(peer: Api.TypePeer | undefined) {
  if (peer instanceof Api.PeerUser) {
    return `tg:user:${peer.userId.toString()}`;
  }
  if (peer instanceof Api.PeerChat) {
    return `tg:chat:${peer.chatId.toString()}`;
  }
  if (peer instanceof Api.PeerChannel) {
    return `tg:channel:${peer.channelId.toString()}`;
  }
  return "";
}

export function jidToEntity(jid: string): EntityLike {
  const user = jid.match(/^tg:user:(.+)$/);
  if (user) {
    return new Api.PeerUser({ userId: bigInt(user[1]) });
  }
  const chat = jid.match(/^tg:chat:(.+)$/);
  if (chat) {
    return new Api.PeerChat({ chatId: bigInt(chat[1]) });
  }
  const channel = jid.match(/^tg:channel:(.+)$/);
  if (channel) {
    return new Api.PeerChannel({ channelId: bigInt(channel[1]) });
  }
  if (/^-?\d+$/.test(jid)) {
    return Number(jid);
  }
  return jid;
}

export function entityDisplayName(entity: unknown) {
  if (entity instanceof Api.User) {
    return [entity.firstName, entity.lastName].filter(Boolean).join(" ") || entity.username || entity.phone || entity.id.toString();
  }
  if (entity instanceof Api.Chat || entity instanceof Api.ChatForbidden) {
    return entity.title;
  }
  if (entity instanceof Api.Channel || entity instanceof Api.ChannelForbidden) {
    return entity.title;
  }
  return undefined;
}

export function normalizeTelegramMessageType(message: Api.Message): "text" | "sticker" | "image" | "video" | "audio" | "document" {
  if (message.sticker) {
    return "sticker";
  }
  if (message.photo) {
    return "image";
  }
  if (message.video) {
    return "video";
  }
  if (message.voice || message.audio) {
    return "audio";
  }
  if (message.document) {
    return "document";
  }
  return "text";
}

export function normalizeTelegramMessageText(message: Api.Message) {
  const text = (message.rawText || message.message || "").trim();
  if (text) {
    return text;
  }
  const type = normalizeTelegramMessageType(message);
  if (type === "image") {
    return "[Image]";
  }
  if (type === "video") {
    return "[Video]";
  }
  if (type === "audio") {
    return "[Audio]";
  }
  if (type === "sticker") {
    return "[Sticker]";
  }
  if (type === "document") {
    return "[Document]";
  }
  return "";
}

export function telegramMessageAtMs(message: Api.Message) {
  const raw = Number(message.date || 0) * 1000;
  return Number.isFinite(raw) && raw > 0 ? raw : Date.now();
}

async function createConvexClient() {
  const url = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("Missing CONVEX_URL or NEXT_PUBLIC_CONVEX_URL for Telegram worker.");
  }
  return new ConvexHttpClient(url);
}

async function reportSetupStatus(convex: ConvexHttpClient, status: "starting" | "connected" | "error", message: string, hasAuth: boolean) {
  await convex
    .mutation(convexRefs.systemUpsertSetupStatus, {
      ...tenantConnectorArgs(),
      provider: "telegram",
      status,
      mode: "phone_code",
      message,
      hasAuth,
      updatedAt: Date.now(),
    })
    .catch(() => undefined);
}

async function reportListener(
  convex: ConvexHttpClient,
  workerId: string,
  listenerActive: boolean,
  listenerMessage: string,
  account?: Api.User,
) {
  await convex
    .mutation(convexRefs.systemReportSetupListener, {
      ...tenantConnectorArgs(),
      provider: "telegram",
      listenerActive,
      listenerWorkerId: workerId,
      listenerMessage,
      listenerLastSeenAt: Date.now(),
      hasAuth: listenerActive,
    })
    .catch(() => undefined);

  if (!listenerActive) {
    await convex
      .mutation(convexRefs.connectedAccountsMarkDisconnectedFromConnector, {
        ...tenantConnectorArgs(),
        deviceId: connectorDeviceId(workerId),
        provider: "telegram",
        authState: "unknown",
        lastSeenAt: Date.now(),
      })
      .catch(() => undefined);
    return;
  }

  if (!account) {
    return;
  }

  await convex
    .mutation(convexRefs.connectedAccountsUpsertFromConnector, {
      ...tenantConnectorArgs(),
      deviceId: connectorDeviceId(workerId),
      provider: "telegram",
      providerAccountId: `telegram:${account.id.toString()}`,
      accountLabel: entityDisplayName(account),
      displayName: entityDisplayName(account),
      phoneNumberMasked: account.phone ? `***${account.phone.slice(-4)}` : undefined,
      username: account.username || undefined,
      authState: "connected",
      lastSeenAt: Date.now(),
    })
    .catch(() => undefined);
}

async function ingestMessage(convex: ConvexHttpClient, event: NewMessageEvent) {
  const message = event.message;
  if (!message || message.out || (event.isChannel && !event.isGroup)) {
    return;
  }

  const threadJid = peerToJid(message.peerId);
  const senderJid = peerToJid(message.fromId || message.peerId);
  const text = normalizeTelegramMessageText(message);
  if (!threadJid || !senderJid || !text) {
    return;
  }

  let senderTitle: string | undefined;
  try {
    senderTitle = entityDisplayName(await message.getSender());
  } catch {
    senderTitle = undefined;
  }

  const isGroup = event.isGroup === true;
  await convex.mutation(convexRefs.inboundIngest, {
    ...tenantConnectorArgs(),
    provider: "telegram",
    threadJid,
    senderJid,
    senderTitle,
    text,
    messageType: normalizeTelegramMessageType(message),
    isGroup,
    threadKind: isGroup ? "group" : "direct",
    providerMessageId: `telegram:${message.id}`,
    messageAt: telegramMessageAtMs(message),
  });
}

async function processOutboxItem(convex: ConvexHttpClient, client: TelegramClient, item: OutboxClaimedItem) {
  if (item.sendKind !== "text") {
    await convex.mutation(convexRefs.outboxMarkFailed, {
      ...tenantConnectorArgs(),
      outboxId: item.outboxId as Id<"outbox">,
      error: `Telegram worker only supports text sends for now; got ${item.sendKind}.`,
    });
    return;
  }

  if (item.isStatusPost) {
    await convex.mutation(convexRefs.outboxMarkFailed, {
      ...tenantConnectorArgs(),
      outboxId: item.outboxId as Id<"outbox">,
      error: "Telegram does not support status posts.",
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

  const sent = await client.sendMessage(jidToEntity(item.jid), { message: item.messageText });
  await convex.mutation(convexRefs.outboxMarkSent, {
    ...tenantConnectorArgs(),
    outboxId: item.outboxId as Id<"outbox">,
    messageProvider: "telegram",
    providerMessageId: `telegram:${sent.id}`,
  });
}

async function pollOutbox(convex: ConvexHttpClient, client: TelegramClient, workerId: string) {
  const claimed = (await convex.mutation(convexRefs.outboxClaimDue, {
    ...tenantConnectorArgs(),
    workerId,
    messageProvider: "telegram",
    limit: 1,
    leaseMs: 3 * 60_000,
  })) as OutboxClaimedItem[];

  for (const item of claimed) {
    try {
      await processOutboxItem(convex, client, item);
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
  await acquireWorkerLock("telegram");
  const convex = await createConvexClient();
  const workerId = process.env.SLM_TELEGRAM_WORKER_ID || process.env.SLM_WORKER_ID || `telegram-worker-${process.pid}`;
  const selfHosted = process.env.ODOGWU_SERVICE_MODE === "self_hosted";
  const tenantId = selfHosted ? "" : (process.env.ODOGWU_TENANT_ID || "").trim();
  const tokenHash = connectorTokenHash();

  if (!selfHosted) {
    if (!tenantId || !tokenHash) {
      logger.warn("Hosted worker missing tenant connector credentials; exiting before connecting Telegram.");
      return;
    }
    const verifiedConnector = await convex
      .mutation(convexRefs.tenantAccountsVerifyConnectorToken, {
        tokenHash,
        provider: "telegram",
      })
      .catch(() => null);
    if (!verifiedConnector) {
      logger.warn("Hosted worker connector is inactive, billing expired, or Telegram is not included in this account plan.");
      return;
    }
  }

  const session = await readTelegramSession();
  if (!session?.apiId || !session.apiHash || !session.sessionString) {
    await reportSetupStatus(convex, "error", "Telegram session is not configured.", false);
    return;
  }

  await reportSetupStatus(convex, "starting", "Starting Telegram worker...", true);

  const client = new TelegramClient(new StringSession(session.sessionString), session.apiId, session.apiHash, {
    connectionRetries: 5,
  });
  await client.connect();
  if (!(await client.checkAuthorization())) {
    await reportSetupStatus(convex, "error", "Telegram session is not authorized. Reconnect Telegram.", false);
    await client.disconnect().catch(() => undefined);
    return;
  }

  const account = await client.getMe();
  await reportSetupStatus(convex, "connected", "Telegram worker is connected.", true);
  await reportListener(convex, workerId, true, "Telegram worker listener is online.", account);

  client.addEventHandler((event) => {
    void ingestMessage(convex, event).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      logger.warn({ err: detail }, "Failed to ingest Telegram message");
    });
  }, new NewMessage({ incoming: true }));

  const outboxPollMs = Math.round(clamp(Number(process.env.SLM_TELEGRAM_OUTBOX_POLL_MS || 4_000), 800, 60_000));
  const outboxTimer = setInterval(() => {
    void pollOutbox(convex, client, workerId).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      logger.warn({ err: detail }, "Telegram outbox poll failed");
    });
  }, outboxPollMs);

  const heartbeatTimer = setInterval(() => {
    void reportListener(convex, workerId, true, "Telegram worker listener is online.", account);
  }, 60_000);

  const shutdown = async () => {
    clearInterval(outboxTimer);
    clearInterval(heartbeatTimer);
    await reportListener(convex, workerId, false, "Telegram worker listener is offline.");
    await client.disconnect().catch(() => undefined);
    releaseWorkerLockSync("telegram");
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });

  logger.info({ workerId, outboxPollMs }, "Telegram worker started");
  await new Promise<void>(() => undefined);
}

const shouldBootWorkerProcess = Boolean(process.argv[1] && /telegram\.(ts|js)$/.test(process.argv[1]));

if (shouldBootWorkerProcess) {
  run().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error({ err: detail }, "Telegram worker crashed");
    releaseWorkerLockSync("telegram");
    process.exitCode = 1;
  });
}
