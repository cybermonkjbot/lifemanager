import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";

export const list = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 30, 100);
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_lastMessageAt")
      .order("desc")
      .take(limit);

    return await Promise.all(
      threads.map(async (thread) => {
        const drafts = await ctx.db
          .query("replyDrafts")
          .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
          .order("desc")
          .take(1);

        return {
          ...thread,
          latestDraft: drafts[0] ?? null,
        };
      }),
    );
  },
});

export const listContacts = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 200, 500);
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_lastMessageAt")
      .order("desc")
      .take(limit);

    return threads
      .filter((thread) => !thread.isGroup)
      .map((thread) => ({
        _id: thread._id,
        jid: thread.jid,
        title: thread.title,
        lastMessageAt: thread.lastMessageAt,
        isIgnored: thread.isIgnored,
      }));
  },
});

export const get = query({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      return null;
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread_messageAt", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(80);

    const messageIds = messages.map((message) => message._id);
    let reactions: Array<{
      messageId: string;
      actorJid: string;
      emoji: string;
      direction: "inbound" | "outbound";
    }> = [];

    if (messageIds.length > 0) {
      const reactionRows = await ctx.db
        .query("messageReactions")
        .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
        .take(300);
      reactions = reactionRows
        .filter((reaction) => messageIds.includes(reaction.messageId))
        .map((reaction) => ({
          messageId: reaction.messageId,
          actorJid: reaction.actorJid,
          emoji: reaction.emoji,
          direction: reaction.direction,
        }));
    }

    const memory = await ctx.db
      .query("threadMemory")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first();

    const grounding = await ctx.db
      .query("threadGrounding")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .first();

    return {
      thread,
      messages: messages.reverse(),
      reactions,
      memory,
      grounding: grounding || null,
    };
  },
});

export const getGenerationContext = internalQuery({
  args: {
    threadId: v.id("threads"),
    sourceMessageId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    const sourceMessage = await ctx.db.get(args.sourceMessageId);

    if (!thread || !sourceMessage) {
      return null;
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread_messageAt", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(20);

    const profile = await ctx.db
      .query("styleProfiles")
      .withIndex("by_scope", (q) => q.eq("scope", "global"))
      .first();

    const grounding = await ctx.db
      .query("threadGrounding")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .first();

    return {
      thread,
      sourceMessage,
      recentMessages: messages.reverse(),
      styleProfile: profile,
      grounding: grounding || null,
    };
  },
});
