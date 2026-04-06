import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

function normalizeName(value: string | undefined) {
  const trimmed = value?.trim() || "";
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, 80);
}

function normalizeAliases(values: string[]) {
  const deduped = new Set(
    values
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => value.slice(0, 50)),
  );
  return [...deduped].slice(0, 20);
}

export const getThreadGrounding = query({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const grounding = await ctx.db
      .query("threadGrounding")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .first();

    return (
      grounding || {
        threadId: args.threadId,
        myName: "",
        theirName: "",
        autoAliases: [],
        vibeNotes: "",
        createdAt: 0,
        updatedAt: 0,
      }
    );
  },
});

export const saveThreadGrounding = mutation({
  args: {
    threadId: v.id("threads"),
    myName: v.optional(v.string()),
    theirName: v.optional(v.string()),
    autoAliases: v.optional(v.array(v.string())),
    vibeNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("threadGrounding")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .first();

    const payload = {
      myName: normalizeName(args.myName),
      theirName: normalizeName(args.theirName),
      autoAliases: normalizeAliases(args.autoAliases || existing?.autoAliases || []),
      vibeNotes: normalizeName(args.vibeNotes),
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }

    return await ctx.db.insert("threadGrounding", {
      threadId: args.threadId,
      createdAt: now,
      ...payload,
    });
  },
});
