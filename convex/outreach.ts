import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getConfig } from "./lib/config";
import { estimateHumanTiming } from "./lib/heuristics";

const MAX_CONFIGURED_CONTACTS = 100;
const MAX_DRAFT_LOOKBACK = 20;
const AI_OUTREACH_PLACEHOLDER = "__SLM_AI_OUTREACH__";

const OUTREACH_ICEBREAKERS = [
  "How is your day going?",
  "What has your week been like?",
  "What are you up to later today?",
  "Tell me one highlight from your day.",
  "Anything fun on your mind today?",
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
    if (configuredContacts.length === 0) {
      return { queued: 0, reason: "no_contacts" as const };
    }

    const cadenceMs = config.outreachCadenceHours * 60 * 60 * 1000;
    const cadenceBucket = Math.floor(now / cadenceMs);
    const maxToQueue = Math.min(config.outreachMaxContactsPerRun, configuredContacts.length);

    const eligible: Array<{
      threadId: Id<"threads">;
      jid: string;
      name: string;
      sourceMessageId: Id<"messages">;
      lastActivityAt: number;
    }> = [];

    for (const jid of configuredContacts) {
      const thread = await ctx.db
        .query("threads")
        .withIndex("by_jid", (q) => q.eq("jid", jid))
        .first();

      if (!thread || thread.isGroup || thread.isIgnored) {
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

      const hasRecentOutreachDraft = recentDrafts.some((draft) => {
        return Boolean(draft.reason?.startsWith("Proactive check-in outreach")) && draft.createdAt + cadenceMs > now;
      });
      if (hasRecentOutreachDraft) {
        continue;
      }

      const lastActivityAt = Math.max(thread.lastMessageAt, latestMessage.messageAt);
      if (lastActivityAt + cadenceMs > now) {
        continue;
      }

      eligible.push({
        threadId: thread._id,
        jid,
        name: extractDisplayName(thread.title, jid),
        sourceMessageId: latestMessage._id,
        lastActivityAt,
      });
    }

    eligible.sort((a, b) => a.lastActivityAt - b.lastActivityAt);
    const targets = eligible.slice(0, maxToQueue);

    let queued = 0;
    for (const target of targets) {
      const text = buildOutreachText({
        jid: target.jid,
        name: target.name,
        template: config.outreachStarterTemplate,
        cadenceBucket,
      });
      const timing = estimateHumanTiming(text);

      const draftId = await ctx.db.insert("replyDrafts", {
        threadId: target.threadId,
        sourceMessageId: target.sourceMessageId,
        text: AI_OUTREACH_PLACEHOLDER,
        sendKind: "text",
        status: "approved",
        confidence: config.aiFallbackConfidence,
        provider: "heuristic",
        delayMs: timing.delayMs,
        typingMs: timing.typingMs,
        reason: `Proactive check-in outreach (AI pending): ${text.slice(0, 180)}`,
        createdAt: now,
        updatedAt: now,
      });

      const outboxId = await ctx.db.insert("outbox", {
        threadId: target.threadId,
        draftId,
        messageText: AI_OUTREACH_PLACEHOLDER,
        sendKind: "text",
        sendAt: now + timing.delayMs,
        status: "pending",
        attempts: 0,
        idempotencyKey: `outreach-${target.threadId}-${cadenceBucket}`,
        provider: "heuristic",
        createdAt: now,
        updatedAt: now,
      });

      await ctx.db.insert("systemEvents", {
        source: "convex",
        eventType: "outreach.queued",
        threadId: target.threadId,
        outboxId,
        detail: text.slice(0, 240),
        createdAt: now,
      });

      queued += 1;
    }

    if (queued > 0) {
      await ctx.db.insert("systemEvents", {
        source: "convex",
        eventType: "outreach.batch",
        detail: `Queued ${queued} proactive outreach message(s).`,
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
