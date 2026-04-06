import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation } from "./_generated/server";
import { getConfig } from "./lib/config";
import { detectPromiseOrPlan, detectTodoCandidate } from "./lib/heuristics";

export const ingest = mutation({
  args: {
    threadJid: v.string(),
    senderJid: v.string(),
    senderTitle: v.optional(v.string()),
    text: v.string(),
    isGroup: v.boolean(),
    whatsappMessageId: v.optional(v.string()),
    messageAt: v.optional(v.number()),
    skipDraftGeneration: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const messageAt = args.messageAt ?? now;

    let thread = await ctx.db
      .query("threads")
      .withIndex("by_jid", (q) => q.eq("jid", args.threadJid))
      .first();

    const config = await getConfig(ctx);
    const shouldIgnoreGroup = args.isGroup && config.ignoreGroupsByDefault;

    if (!thread) {
      const threadId = await ctx.db.insert("threads", {
        jid: args.threadJid,
        title: args.senderTitle,
        isGroup: args.isGroup,
        isIgnored: shouldIgnoreGroup,
        lastMessageAt: messageAt,
        createdAt: now,
        updatedAt: now,
      });

      thread = await ctx.db.get(threadId);
      if (!thread) {
        throw new Error("Unable to create thread");
      }
    } else {
      await ctx.db.patch(thread._id, {
        title: args.senderTitle ?? thread.title,
        isGroup: args.isGroup,
        lastMessageAt: messageAt,
        updatedAt: now,
      });
    }

    const explicitIgnore = await ctx.db
      .query("ignoreRules")
      .withIndex("by_target", (q) => q.eq("targetType", args.isGroup ? "group" : "contact").eq("targetValue", args.threadJid))
      .first();

    const ignored = thread.isIgnored || Boolean(explicitIgnore?.enabled);

    if (args.whatsappMessageId) {
      const existing = await ctx.db
        .query("messages")
        .withIndex("by_thread_whatsappMessageId", (q) =>
          q.eq("threadId", thread._id).eq("whatsappMessageId", args.whatsappMessageId),
        )
        .first();

      if (existing) {
        await ctx.db.insert("systemEvents", {
          source: "worker",
          eventType: "inbound.duplicate",
          threadId: thread._id,
          detail: args.text.slice(0, 300),
          createdAt: now,
        });

        return {
          threadId: thread._id,
          messageId: existing._id,
          ignored: true,
          duplicate: true,
          promiseDetected: false,
          todoDetected: false,
        };
      }
    }

    const messageId = await ctx.db.insert("messages", {
      threadId: thread._id,
      direction: "inbound",
      whatsappMessageId: args.whatsappMessageId,
      senderJid: args.senderJid,
      text: args.text,
      messageAt,
      createdAt: now,
    });

    await ctx.db.insert("systemEvents", {
      source: "worker",
      eventType: ignored ? "inbound.ignored" : "inbound.received",
      threadId: thread._id,
      detail: args.text.slice(0, 300),
      createdAt: now,
    });

    const promise = detectPromiseOrPlan(args.text);
    if (promise) {
      await ctx.db.insert("followUps", {
        threadId: thread._id,
        sourceMessageId: messageId,
        reason: promise.reason,
        draftText: "Following up on this so we stay aligned.",
        dueAt: promise.dueAt,
        status: "suggested",
        createdAt: now,
        updatedAt: now,
      });
    }

    const todo = detectTodoCandidate(args.text);
    if (todo) {
      await ctx.db.insert("todoCandidates", {
        threadId: thread._id,
        sourceMessageId: messageId,
        title: todo.title,
        suggestedDueAt: todo.suggestedDueAt,
        status: "suggested",
        createdAt: now,
        updatedAt: now,
      });
    }

    if (!ignored && !args.skipDraftGeneration) {
      await ctx.scheduler.runAfter(0, internal.draft.generate, {
        threadId: thread._id,
        sourceMessageId: messageId,
      });
    }

    await ctx.scheduler.runAfter(0, internal.memory.summarize, {
      threadId: thread._id,
    });

    return {
      threadId: thread._id,
      messageId,
      ignored,
      duplicate: false,
      promiseDetected: Boolean(promise),
      todoDetected: Boolean(todo),
    };
  },
});
