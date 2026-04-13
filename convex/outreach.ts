import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getConfig } from "./lib/config";
import { estimateHumanTiming } from "./lib/heuristics";
import { classifyThreadKind } from "./lib/threadEligibility";
import {
  COMPLIMENT_OUTREACH_REASON_PREFIX,
  PROACTIVE_OUTREACH_REASON_PREFIX,
  isConversationStarterReason,
} from "./lib/outreachModes";

const MAX_CONFIGURED_CONTACTS = 100;
const MAX_DRAFT_LOOKBACK = 20;
const AI_OUTREACH_PLACEHOLDER = "__SLM_AI_OUTREACH__";
const COMPLIMENT_COOLDOWN_MS = 4 * 24 * 60 * 60 * 1000;
const COMPLIMENT_SELECTION_THRESHOLD = 0.24;

const OUTREACH_ICEBREAKERS = [
  "How is your day going?",
  "What has your week been like?",
  "What are you up to later today?",
  "Tell me one highlight from your day.",
  "Anything fun on your mind today?",
];
const RANDOM_COMPLIMENT_SEEDS = [
  "You always carry yourself with grace.",
  "You have a way of making ordinary days feel lighter.",
  "Your mind and heart are both beautiful.",
  "You look stunning, even in the smallest moments.",
  "You have a calm confidence I admire.",
  "You make me smile without trying.",
  "Your energy is soft and powerful at the same time.",
  "You are genuinely unforgettable.",
  "The way you think is seriously attractive.",
  "You have a rare kind of warmth.",
  "You are elegant in a way words barely cover.",
  "You make kindness look effortless.",
  "Your presence always feels like peace.",
  "You have a beautiful spirit and it shows.",
  "You carry yourself like someone who knows her worth.",
  "You are one of the most naturally beautiful women I know.",
  "Your smile stays on my mind longer than it should.",
  "You make confidence look gentle.",
  "You are magnetic in the best way.",
  "You always look like a whole mood.",
  "Your vibe is pure class.",
  "You are beautiful and grounded, which is rare.",
  "You make simple things feel special.",
  "You are effortlessly attractive.",
  "You have a really lovely heart.",
];

function isWithinHourWindow(hour: number, startHour: number, endHour: number) {
  if (startHour === endHour) {
    return false;
  }
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  return hour >= startHour || hour < endHour;
}

export function shouldPauseOutreachForQuietHours(args: {
  quietHoursEnabled: boolean;
  nowHour: number;
  quietHoursStartHour: number;
  quietHoursEndHour: number;
}) {
  if (!args.quietHoursEnabled) {
    return false;
  }
  return isWithinHourWindow(args.nowHour, args.quietHoursStartHour, args.quietHoursEndHour);
}

function pickVariant(seed: string, options: string[]) {
  if (options.length === 0) {
    return "";
  }

  const sum = [...seed].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return options[sum % options.length];
}

function stableHash(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function extractDisplayName(threadTitle: string | undefined, jid: string) {
  const base = threadTitle?.trim();
  if (base) {
    return base.split(/\s+/)[0] || base;
  }
  return jid.replace(/@s\.whatsapp\.net$/i, "").slice(0, 18);
}

function buildOutreachText(args: {
  jid: string;
  name: string;
  template: string;
  cadenceBucket: number;
}) {
  const icebreaker = pickVariant(`${args.jid}-${args.cadenceBucket}`, OUTREACH_ICEBREAKERS);
  const withName = args.template.replace(/\{\{\s*name\s*\}\}/gi, args.name);
  const withIcebreaker = withName.replace(/\{\{\s*icebreaker\s*\}\}/gi, icebreaker);
  if (withIcebreaker !== withName) {
    return withIcebreaker;
  }
  return `${withName} ${icebreaker}`.trim();
}

export function hasRecentComplimentDraft(args: {
  drafts: Array<{ reason?: string; createdAt: number }>;
  now: number;
}) {
  return args.drafts.some((draft) => {
    if (!draft.reason || !draft.reason.startsWith(COMPLIMENT_OUTREACH_REASON_PREFIX)) {
      return false;
    }
    return args.now - draft.createdAt < COMPLIMENT_COOLDOWN_MS;
  });
}

export function shouldQueueRandomCompliment(args: {
  threadId: Id<"threads">;
  cadenceBucket: number;
  hasRecentCompliment: boolean;
}) {
  if (args.hasRecentCompliment) {
    return false;
  }
  const sample = (stableHash(`${args.threadId}|${args.cadenceBucket}|compliment`) % 1000) / 1000;
  return sample < COMPLIMENT_SELECTION_THRESHOLD;
}

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const config = await getConfig(ctx);
    const nowHour = new Date(now).getHours();

    if (!config.outreachEnabled) {
      return { queued: 0, reason: "outreach_disabled" as const };
    }

    if (config.autonomyPaused) {
      return { queued: 0, reason: "autonomy_paused" as const };
    }

    if (
      shouldPauseOutreachForQuietHours({
        quietHoursEnabled: config.quietHoursEnabled,
        nowHour,
        quietHoursStartHour: config.quietHoursStartHour,
        quietHoursEndHour: config.quietHoursEndHour,
      })
    ) {
      return { queued: 0, reason: "night_wind_down" as const };
    }

    const configuredContacts = config.outreachContactJids.slice(0, MAX_CONFIGURED_CONTACTS);
    const romanticJids = new Set(config.romanticPartnerJids.map((jid) => jid.trim().toLowerCase()).filter(Boolean));
    if (configuredContacts.length === 0) {
      return { queued: 0, reason: "no_contacts" as const };
    }

    const cadenceMs = config.outreachCadenceHours * 60 * 60 * 1000;
    const cadenceBucket = Math.floor(now / cadenceMs);
    const maxToQueue = Math.min(config.outreachMaxContactsPerRun, configuredContacts.length);

    const eligible: Array<{
      threadId: Id<"threads">;
      messageProvider: "whatsapp" | "instagram";
      jid: string;
      name: string;
      sourceMessageId: Id<"messages">;
      lastActivityAt: number;
      outreachMode: "proactive" | "compliment";
      seedText: string;
    }> = [];

    for (const jid of configuredContacts) {
      const thread = await ctx.db
        .query("threads")
        .withIndex("by_jid", (q) => q.eq("jid", jid))
        .first();

      if (!thread || thread.isIgnored) {
        continue;
      }

      const threadKind = thread.threadKind || classifyThreadKind({ jid: thread.jid, isGroupHint: thread.isGroup });
      if (threadKind === "group") {
        continue;
      }

      if ((thread.nightPausedUntil || 0) > now) {
        continue;
      }

      const explicitIgnore = await ctx.db
        .query("ignoreRules")
        .withIndex("by_target", (q) => q.eq("targetType", "contact").eq("targetValue", jid))
        .first();

      if (explicitIgnore?.enabled) {
        continue;
      }

      const latestMessage = await ctx.db
        .query("messages")
        .withIndex("by_thread_messageAt", (q) => q.eq("threadId", thread._id))
        .order("desc")
        .first();

      if (!latestMessage) {
        continue;
      }

      const hasPending = await ctx.db
        .query("outbox")
        .withIndex("by_thread_and_status", (q) => q.eq("threadId", thread._id).eq("status", "pending"))
        .first();

      if (hasPending) {
        continue;
      }

      const hasClaimed = await ctx.db
        .query("outbox")
        .withIndex("by_thread_and_status", (q) => q.eq("threadId", thread._id).eq("status", "claimed"))
        .first();

      if (hasClaimed) {
        continue;
      }

      const recentDrafts = await ctx.db
        .query("replyDrafts")
        .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
        .order("desc")
        .take(MAX_DRAFT_LOOKBACK);

      const conversationStarterCooldownMs = Math.max(
        60 * 60 * 1000,
        Math.round((config.romanticMorningCollisionCooldownHours || 8) * 60 * 60 * 1000),
      );
      const hasRecentConversationStarter = recentDrafts.some((draft) => {
        if (!isConversationStarterReason(draft.reason)) {
          return false;
        }
        return draft.createdAt + conversationStarterCooldownMs > now;
      });
      if (hasRecentConversationStarter) {
        continue;
      }

      const lastActivityAt = Math.max(thread.lastMessageAt, latestMessage.messageAt);
      if (lastActivityAt + cadenceMs > now) {
        continue;
      }

      const isRomantic = romanticJids.has(jid.trim().toLowerCase());
      const hasRecentCompliment = hasRecentComplimentDraft({
        drafts: recentDrafts,
        now,
      });
      const complimentMode = isRomantic
        ? shouldQueueRandomCompliment({
            threadId: thread._id,
            cadenceBucket,
            hasRecentCompliment,
          })
        : false;
      const proactiveText = buildOutreachText({
        jid,
        name: extractDisplayName(thread.title, jid),
        template: config.outreachStarterTemplate,
        cadenceBucket,
      });
      const complimentSeed = pickVariant(`${thread._id}|${cadenceBucket}|appreciation`, RANDOM_COMPLIMENT_SEEDS);

      eligible.push({
        threadId: thread._id,
        messageProvider: thread.provider || "whatsapp",
        jid,
        name: extractDisplayName(thread.title, jid),
        sourceMessageId: latestMessage._id,
        lastActivityAt,
        outreachMode: complimentMode ? "compliment" : "proactive",
        seedText: complimentMode ? complimentSeed : proactiveText,
      });
    }

    eligible.sort((a, b) => a.lastActivityAt - b.lastActivityAt);
    const targets = eligible.slice(0, maxToQueue);

    let queued = 0;
    for (const target of targets) {
      const text = target.seedText;
      const timing = estimateHumanTiming(text);
      const reasonPrefix =
        target.outreachMode === "compliment" ? COMPLIMENT_OUTREACH_REASON_PREFIX : PROACTIVE_OUTREACH_REASON_PREFIX;

      const draftId = await ctx.db.insert("replyDrafts", {
        messageProvider: target.messageProvider,
        threadId: target.threadId,
        sourceMessageId: target.sourceMessageId,
        text: AI_OUTREACH_PLACEHOLDER,
        sendKind: "text",
        outreachMode: target.outreachMode,
        status: "approved",
        confidence: config.aiFallbackConfidence,
        provider: "heuristic",
        delayMs: timing.delayMs,
        typingMs: timing.typingMs,
        reason: `${reasonPrefix} (AI pending): ${text.slice(0, 180)}`,
        createdAt: now,
        updatedAt: now,
      });

      const outboxId = await ctx.db.insert("outbox", {
        messageProvider: target.messageProvider,
        threadId: target.threadId,
        draftId,
        messageText: AI_OUTREACH_PLACEHOLDER,
        sendKind: "text",
        outreachMode: target.outreachMode,
        sendAt: now + timing.delayMs,
        status: "pending",
        attempts: 0,
        idempotencyKey: `outreach-${target.threadId}-${cadenceBucket}-${target.outreachMode}`,
        provider: "heuristic",
        createdAt: now,
        updatedAt: now,
      });

      await ctx.db.insert("systemEvents", {
        source: "convex",
        eventType: "outreach.queued",
        threadId: target.threadId,
        outboxId,
        detail: `${target.outreachMode}: ${text.slice(0, 220)}`,
        createdAt: now,
      });

      queued += 1;
    }

    if (queued > 0) {
      await ctx.db.insert("systemEvents", {
        source: "convex",
        eventType: "outreach.batch",
        detail: `Queued ${queued} outreach message(s).`,
        createdAt: now,
      });
    }

    return {
      queued,
      eligibleCount: eligible.length,
      configuredCount: configuredContacts.length,
      reason: "ok" as const,
    };
  },
});
