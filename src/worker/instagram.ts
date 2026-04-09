import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import type { Id } from "../../convex/_generated/dataModel";
import { IgApiClient } from "instagram-private-api";
import pino from "pino";
import { convexRefs } from "../lib/convex-refs";
import { acquireWorkerLock, releaseWorkerLockSync } from "../lib/runtime/worker-lock";

type MessageProvider = "whatsapp" | "instagram";

type SetupStatus = {
  status: "idle" | "starting" | "authenticating" | "qr_ready" | "code_ready" | "challenge_required" | "syncing" | "connected" | "error";
  mode: "qr" | "pairing_code" | "password" | "challenge_code";
  message: string;
  hasAuth: boolean;
  updatedAt: number;
};

type RuntimeSettings = {
  outboxPollMs?: number;
  instagramDmDelayMinMs?: number;
  instagramDmDelayMaxMs?: number;
  instagramTypingMinMs?: number;
  instagramTypingMaxMs?: number;
};

type OutboxClaimedItem = {
  outboxId: string;
  threadId: string;
  jid: string;
  messageText: string;
  typingMs: number;
  messageProvider: MessageProvider;
  provider: "azure" | "codex" | "heuristic";
  sendKind: "text" | "reaction" | "sticker" | "meme";
  isStatusPost?: boolean;
  mediaAssetId?: string;
  mediaCaption?: string;
  reactionEmoji?: string;
  reactionTargetProviderMessageId?: string;
};

type InstagramThreadItem = {
  thread_id: string;
  thread_title?: string;
  is_group?: boolean;
  users?: Array<{
    pk?: number;
    username?: string;
    full_name?: string;
  }>;
  items?: Array<{
    item_id?: string;
    user_id?: number;
    timestamp?: string | number;
    item_type?: string;
    text?: string;
  }>;
};

const IG_STORY_JID = "ig:story:broadcast";
const MAX_SEEN_ITEM_IDS = 12_000;
const QUALITY_FIRST_IG_DELAY_MIN_MS = 14_000;
const QUALITY_FIRST_IG_DELAY_MAX_MS = 70_000;
const QUALITY_FIRST_IG_TYPING_MIN_MS = 2_800;
const QUALITY_FIRST_IG_TYPING_MAX_MS = 11_000;

const logger = pino({
  name: "slm-instagram-worker",
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

function randomIntInclusive(min: number, max: number) {
  if (max <= min) {
    return min;
  }
  return min + Math.floor(Math.random() * (max - min + 1));
}

function normalizeInstagramAuthDir() {
  const configured = (process.env.INSTAGRAM_AUTH_PATH || "").trim();
  if (!configured) {
    return join(process.cwd(), ".ig_auth");
  }
  if (configured.startsWith("/")) {
    return configured;
  }
  return join(process.cwd(), configured);
}

export function parseInstagramTimestampMs(raw: unknown, fallback: number) {
  if (raw === undefined || raw === null) {
    return fallback;
  }
  const rawString = String(raw).trim();
  if (!/^\d+$/.test(rawString)) {
    return fallback;
  }
  const parsed = Number(rawString);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  // Instagram direct timestamps are typically microseconds.
  if (rawString.length >= 14) {
    return Math.round(parsed / 1000);
  }
  if (rawString.length >= 11) {
    return Math.round(parsed);
  }
  return Math.round(parsed * 1000);
}

function resolveThreadJid(threadId: string) {
  return `ig:thread:${threadId}`;
}

export function parseThreadIdFromJid(jid: string) {
  if (!jid) {
    return null;
  }
  if (jid.startsWith("ig:thread:")) {
    return jid.slice("ig:thread:".length);
  }
  if (jid.startsWith("instagram:thread:")) {
    return jid.slice("instagram:thread:".length);
  }
  return null;
}

function extractProviderMessageId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const row = value as {
    payload?: { item_id?: string };
    item_id?: string;
    media?: { id?: string };
    id?: string;
  };
  return row.payload?.item_id || row.item_id || row.media?.id || row.id || undefined;
}

export function normalizeInboundText(itemType: string, text?: string) {
  const normalized = (text || "").trim();
  if (normalized) {
    return normalized;
  }

  if (itemType === "like") {
    return "Reacted with ❤️";
  }
  if (itemType.includes("story") || itemType.includes("reel")) {
    return "Sent a story reply";
  }
  if (itemType.includes("voice")) {
    return "[Voice note]";
  }
  if (itemType.includes("video")) {
    return "[Video]";
  }
  if (itemType.includes("media")) {
    return "[Image]";
  }
  return "[Message]";
}

export function normalizeInboundMessageType(itemType: string): "text" | "reaction" | "sticker" | "meme" | "image" | "video" | "audio" | "document" {
  if (itemType === "like") {
    return "reaction";
  }
  if (itemType.includes("voice")) {
    return "audio";
  }
  if (itemType.includes("video")) {
    return "video";
  }
  if (itemType.includes("media") || itemType.includes("story") || itemType.includes("reel")) {
    return "image";
  }
  return "text";
}

export function shouldSkipInstagramTextOnlyStory(item: { isStatusPost?: boolean; mediaAssetId?: string }) {
  return item.isStatusPost === true && !item.mediaAssetId;
}

async function createConvexClient() {
  const url = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("Missing CONVEX_URL or NEXT_PUBLIC_CONVEX_URL for Instagram worker.");
  }
  return new ConvexHttpClient(url);
}

async function loadInstagramSessionState(authDir: string) {
  const [metaRaw, sessionRaw] = await Promise.all([
    readFile(join(authDir, "session-meta.json"), "utf8"),
    readFile(join(authDir, "session.json"), "utf8"),
  ]);
  const meta = JSON.parse(metaRaw) as { username?: string };
  const serializedState = JSON.parse(sessionRaw) as Record<string, unknown>;
  if (!meta.username) {
    throw new Error("Instagram session metadata missing username.");
  }
  return {
    username: meta.username,
    serializedState,
  };
}

async function restoreInstagramClient(authDir: string) {
  const { username, serializedState } = await loadInstagramSessionState(authDir);
  const ig = new IgApiClient();
  ig.state.generateDevice(username);
  await ig.state.deserialize(serializedState);
  return { ig, username };
}

async function persistInstagramSession(authDir: string, ig: IgApiClient, username: string) {
  const serializedState = (await ig.state.serialize()) as Record<string, unknown>;
  delete (serializedState as { constants?: unknown }).constants;

  await writeFile(join(authDir, "session.json"), JSON.stringify(serializedState), "utf8");
  await writeFile(
    join(authDir, "session-meta.json"),
    JSON.stringify({ username, updatedAt: Date.now() }),
    "utf8",
  );
}

async function readRuntimeSettings(convex: ConvexHttpClient): Promise<RuntimeSettings> {
  try {
    return (await convex.query(convexRefs.settingsGet, {})) as RuntimeSettings;
  } catch {
    return {};
  }
}

async function fetchMediaAssetDownload(convex: ConvexHttpClient, assetId: string) {
  return (await convex.query(convexRefs.mediaGetAssetDownloadUrl, {
    assetId: assetId as Id<"mediaAssets">,
  })) as
    | {
        assetId: string;
        kind: "sticker" | "meme" | "image" | "video" | "audio" | "document";
        mimeType: string;
        url: string;
      }
    | null;
}

async function fetchMediaBuffer(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch media asset (${response.status}).`);
  }
  const bytes = await response.arrayBuffer();
  return Buffer.from(bytes);
}

async function extractVideoCoverFrame(videoBuffer: Buffer) {
  const tempDir = await mkdtemp(join(tmpdir(), "slm-ig-video-"));
  const inputPath = join(tempDir, "story-video.mp4");
  const outputPath = join(tempDir, "story-cover.jpg");
  const ffmpegPath = process.env.SLM_FFMPEG_PATH || "ffmpeg";

  try {
    await writeFile(inputPath, videoBuffer);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegPath, ["-y", "-i", inputPath, "-frames:v", "1", outputPath], {
        stdio: "ignore",
      });
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`ffmpeg exited with code ${code}.`));
      });
    });

    return await readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function run() {
  await acquireWorkerLock("instagram");
  const convex = await createConvexClient();
  const workerId = process.env.SLM_INSTAGRAM_WORKER_ID || process.env.SLM_WORKER_ID || `instagram-worker-${process.pid}`;
  const authDir = normalizeInstagramAuthDir();

  const seenInboundIds = new Set<string>();
  const seenQueue: string[] = [];
  let processingInbox = false;
  let processingOutbox = false;
  let isShuttingDown = false;
  let isFirstInboxSync = true;
  let ig: IgApiClient | null = null;
  let igUsername = "";
  let selfUserPk = "";

  const markSeen = (key: string) => {
    if (seenInboundIds.has(key)) {
      return;
    }
    seenInboundIds.add(key);
    seenQueue.push(key);
    if (seenQueue.length <= MAX_SEEN_ITEM_IDS) {
      return;
    }
    const oldest = seenQueue.shift();
    if (oldest) {
      seenInboundIds.delete(oldest);
    }
  };

  const reportListener = async (listenerActive: boolean, listenerMessage: string, hasAuth: boolean) => {
    try {
      await convex.mutation(convexRefs.systemReportSetupListener, {
        provider: "instagram",
        listenerActive,
        listenerWorkerId: workerId,
        listenerMessage,
        listenerLastSeenAt: Date.now(),
        hasAuth,
      });
    } catch {
      // best effort setup sync
    }
  };

  const reportSetupStatus = async (state: SetupStatus) => {
    try {
      await convex.mutation(convexRefs.systemUpsertSetupStatus, {
        provider: "instagram",
        ...state,
      });
    } catch {
      // best effort setup sync
    }
  };

  const shutdown = async (exitCode: number, reason: string) => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    logger.info({ reason }, "Instagram worker shutting down");
    await reportListener(false, reason, true).catch(() => undefined);
    releaseWorkerLockSync("instagram");
    process.exit(exitCode);
  };

  process.on("SIGINT", () => {
    void shutdown(0, "Instagram worker stopped.");
  });
  process.on("SIGTERM", () => {
    void shutdown(0, "Instagram worker stopped.");
  });

  try {
    const restored = await restoreInstagramClient(authDir);
    ig = restored.ig;
    igUsername = restored.username;

    const me = await ig.account.currentUser();
    selfUserPk = String(me.pk || "");
    await persistInstagramSession(authDir, ig, igUsername);

    await reportSetupStatus({
      status: "connected",
      mode: "password",
      message: "Instagram connected. Worker is running.",
      hasAuth: true,
      updatedAt: Date.now(),
    });
    await reportListener(true, "Instagram worker listener is online.", true);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await reportSetupStatus({
      status: "error",
      mode: "password",
      message: `Instagram session invalid. ${detail}`,
      hasAuth: false,
      updatedAt: Date.now(),
    }).catch(() => undefined);
    await reportListener(false, "Instagram worker failed to authenticate.", false).catch(() => undefined);
    throw error;
  }

  const pollInbox = async () => {
    if (processingInbox || isShuttingDown || !ig) {
      return;
    }
    processingInbox = true;
    try {
      const inboxFeed = ig.feed.directInbox();
      const threads = (await inboxFeed.items()) as InstagramThreadItem[];
      const now = Date.now();

      for (const thread of threads) {
        const threadId = String(thread.thread_id || "").trim();
        if (!threadId) {
          continue;
        }
        const threadJid = resolveThreadJid(threadId);
        const isGroup = Boolean(thread.is_group);
        const threadKind = isGroup ? "group" : "direct";
        const users = thread.users || [];
        const titleFromUsers = users
          .map((user) => (user.full_name || user.username || "").trim())
          .filter(Boolean)
          .join(", ");
        const senderTitleFallback = (thread.thread_title || titleFromUsers || undefined)?.trim();
        const items = [...(thread.items || [])]
          .filter((item) => Boolean(item.item_id))
          .sort((a, b) => parseInstagramTimestampMs(a.timestamp, now) - parseInstagramTimestampMs(b.timestamp, now));
        const maxItems = isFirstInboxSync ? 10 : 30;
        const scopedItems = items.slice(-maxItems);

        for (const item of scopedItems) {
          const itemId = String(item.item_id || "").trim();
          if (!itemId) {
            continue;
          }
          const seenKey = `${threadId}:${itemId}`;
          if (seenInboundIds.has(seenKey)) {
            continue;
          }
          markSeen(seenKey);

          const senderPk = String(item.user_id || "");
          if (!senderPk || senderPk === selfUserPk) {
            continue;
          }
          const senderProfile = users.find((user) => String(user.pk || "") === senderPk);
          const senderTitle = (senderProfile?.full_name || senderProfile?.username || senderTitleFallback || undefined)?.trim();
          const itemType = String(item.item_type || "text").toLowerCase();
          const text = normalizeInboundText(itemType, item.text);
          const messageType = normalizeInboundMessageType(itemType);
          const isStatus = itemType.includes("story") || itemType.includes("reel");
          const messageAt = parseInstagramTimestampMs(item.timestamp, now);

          await convex.mutation(convexRefs.inboundIngest, {
            provider: "instagram",
            threadJid,
            senderJid: `ig:user:${senderPk}`,
            senderTitle,
            text,
            messageType,
            reactionEmoji: itemType === "like" ? "❤️" : undefined,
            isStatus,
            isGroup,
            threadKind,
            providerMessageId: itemId,
            messageAt,
          });
        }
      }

      isFirstInboxSync = false;
      await reportListener(true, "Instagram worker listener is online.", true);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.warn({ err: detail }, "Instagram inbox poll failed");
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "instagram.inbox.poll_error",
          detail: detail.slice(0, 300),
        })
        .catch(() => undefined);
    } finally {
      processingInbox = false;
    }
  };

  const processOutboxItem = async (item: OutboxClaimedItem) => {
    if (!ig) {
      throw new Error("Instagram client is not initialized.");
    }

    const sendDisposition = (await convex.query(convexRefs.outboxGetSendDisposition, {
      outboxId: item.outboxId as Id<"outbox">,
    })) as { canSend: boolean; reason?: string };
    if (!sendDisposition.canSend) {
      return;
    }

    const runtime = await readRuntimeSettings(convex);
    const igDelayMin = Math.round(
      clamp(Math.max(runtime.instagramDmDelayMinMs ?? 16_000, QUALITY_FIRST_IG_DELAY_MIN_MS), 500, 180_000),
    );
    const igDelayMax = Math.round(
      clamp(
        Math.max(runtime.instagramDmDelayMaxMs ?? 75_000, QUALITY_FIRST_IG_DELAY_MAX_MS),
        igDelayMin,
        240_000,
      ),
    );
    const igTypingMin = Math.round(
      clamp(Math.max(runtime.instagramTypingMinMs ?? 3_000, QUALITY_FIRST_IG_TYPING_MIN_MS), 200, 60_000),
    );
    const igTypingMax = Math.round(
      clamp(
        Math.max(runtime.instagramTypingMaxMs ?? 11_000, QUALITY_FIRST_IG_TYPING_MAX_MS),
        igTypingMin,
        120_000,
      ),
    );
    const typingMs = Math.round(clamp(item.typingMs || igTypingMin, igTypingMin, igTypingMax));

	    if (item.isStatusPost) {
	      if (shouldSkipInstagramTextOnlyStory(item)) {
        const reason = "Instagram stories require image/video media. Text-only stories are skipped in v1.";
        await convex.mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "instagram.story.skipped.text_only",
          threadId: item.threadId as Id<"threads">,
          outboxId: item.outboxId as Id<"outbox">,
          detail: reason,
        });
        await convex.mutation(convexRefs.outboxMarkFailed, {
          outboxId: item.outboxId as Id<"outbox">,
          error: reason,
          forceFinal: true,
        });
	        return;
	      }

	      const storyMediaAssetId = item.mediaAssetId;
	      if (!storyMediaAssetId) {
	        throw new Error("Instagram story media asset is missing.");
	      }
	      const media = await fetchMediaAssetDownload(convex, storyMediaAssetId);
      if (!media?.url) {
        throw new Error("Instagram story media asset is unavailable.");
      }
      if (media.kind !== "image" && media.kind !== "video" && media.kind !== "meme") {
        throw new Error(`Unsupported Instagram story media kind: ${media.kind}.`);
      }

      const payload = await fetchMediaBuffer(media.url);
      let response: unknown;
      if (media.kind === "video") {
        const coverImage = await extractVideoCoverFrame(payload);
        response = await ig.publish.story({
          video: payload,
          coverImage,
          caption: item.mediaCaption?.trim() || item.messageText?.trim() || undefined,
        });
      } else {
        response = await ig.publish.story({
          file: payload,
          caption: item.mediaCaption?.trim() || item.messageText?.trim() || undefined,
        });
      }

      await convex.mutation(convexRefs.outboxMarkSent, {
        outboxId: item.outboxId as Id<"outbox">,
        messageProvider: "instagram",
        providerMessageId: extractProviderMessageId(response),
      });
      return;
    }

    const threadId = parseThreadIdFromJid(item.jid);
    if (!threadId) {
      throw new Error(`Unsupported Instagram thread jid: ${item.jid}`);
    }
    const thread = ig.entity.directThread(threadId);

    const dmDelayMs = randomIntInclusive(igDelayMin, igDelayMax);
    await sleep(dmDelayMs);
    await convex.mutation(convexRefs.outboxMarkTyping, {
      outboxId: item.outboxId as Id<"outbox">,
    });
    await sleep(typingMs);

    const postTypingDisposition = (await convex.query(convexRefs.outboxGetSendDisposition, {
      outboxId: item.outboxId as Id<"outbox">,
    })) as { canSend: boolean; reason?: string };
    if (!postTypingDisposition.canSend) {
      return;
    }

    let sendResponse: unknown;

    if (item.sendKind === "reaction") {
      const emoji = (item.reactionEmoji || "❤️").trim();
      sendResponse = await thread.broadcastText(emoji);
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "instagram.reaction.sent_as_text",
          threadId: item.threadId as Id<"threads">,
          outboxId: item.outboxId as Id<"outbox">,
          detail: `Sent reaction as text fallback (${emoji}).`,
        })
        .catch(() => undefined);
    } else if (item.mediaAssetId) {
      const media = await fetchMediaAssetDownload(convex, item.mediaAssetId);
      if (!media?.url) {
        throw new Error("Instagram media asset is unavailable.");
      }
      const payload = await fetchMediaBuffer(media.url);
      if (media.kind === "video") {
        sendResponse = await thread.broadcastVideo({ video: payload });
      } else {
        sendResponse = await thread.broadcastPhoto({ file: payload });
      }
      const caption = (item.mediaCaption || item.messageText || "").trim();
      if (caption) {
        await thread.broadcastText(caption);
      }
    } else {
      const text = (item.messageText || "").trim();
      if (!text) {
        throw new Error("Cannot send empty Instagram DM message.");
      }
      sendResponse = await thread.broadcastText(text);
    }

    await convex.mutation(convexRefs.outboxMarkSent, {
      outboxId: item.outboxId as Id<"outbox">,
      messageProvider: "instagram",
      providerMessageId: extractProviderMessageId(sendResponse),
    });
  };

  const pollOutbox = async () => {
    if (processingOutbox || isShuttingDown) {
      return;
    }
    processingOutbox = true;
    try {
      const claimed = (await convex.mutation(convexRefs.outboxClaimDue, {
        workerId,
        messageProvider: "instagram",
      })) as OutboxClaimedItem[];

      for (const item of claimed) {
        try {
          await processOutboxItem(item);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          await convex.mutation(convexRefs.outboxMarkFailed, {
            outboxId: item.outboxId as Id<"outbox">,
            error: detail.slice(0, 300),
          });
        }
      }
    } finally {
      processingOutbox = false;
    }
  };

  const runtime = await readRuntimeSettings(convex);
  const outboxPollMs = Math.round(
    clamp(
      Number(process.env.SLM_INSTAGRAM_OUTBOX_POLL_MS || runtime.outboxPollMs || 4_000),
      800,
      60_000,
    ),
  );
  const inboxPollMs = Math.round(
    clamp(
      Number(process.env.SLM_INSTAGRAM_INBOX_POLL_MS || 8_000),
      2_000,
      90_000,
    ),
  );

  logger.info(
    {
      workerId,
      outboxPollMs,
      inboxPollMs,
      authDir,
      storyJid: IG_STORY_JID,
    },
    "Instagram worker started",
  );

  setInterval(() => {
    void pollInbox();
  }, inboxPollMs);

  setInterval(() => {
    void pollOutbox();
  }, outboxPollMs);

  void pollInbox();
  void pollOutbox();
}

const shouldBootWorkerProcess = Boolean(process.argv[1] && /instagram\.(ts|js)$/.test(process.argv[1]));

if (shouldBootWorkerProcess) {
  void run().catch(async (error) => {
    const detail = error instanceof Error ? error.message : String(error);
    releaseWorkerLockSync("instagram");
    logger.error({ err: detail }, "Instagram worker crashed");
    process.exit(1);
  });
}
