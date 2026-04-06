import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {
    todoLimit: v.optional(v.number()),
    candidateLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const todoLimit = Math.min(args.todoLimit ?? 100, 250);
    const candidateLimit = Math.min(args.candidateLimit ?? 80, 200);
    const todos = await ctx.db
      .query("todos")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .order("desc")
      .take(todoLimit);
    const candidates = await ctx.db
      .query("todoCandidates")
      .withIndex("by_status", (q) => q.eq("status", "suggested"))
      .order("desc")
      .take(candidateLimit);

    return {
      todos,
      candidates,
    };
  },
});

export const fromCandidate = mutation({
  args: {
    candidateId: v.id("todoCandidates"),
  },
  handler: async (ctx, args) => {
    const candidate = await ctx.db.get(args.candidateId);
    if (!candidate) {
      throw new Error("Candidate not found");
    }

    const now = Date.now();
    await ctx.db.patch(candidate._id, {
      status: "accepted",
      updatedAt: now,
    });

    const todoId = await ctx.db.insert("todos", {
      threadId: candidate.threadId,
      sourceMessageId: candidate.sourceMessageId,
      title: candidate.title,
      dueAt: candidate.suggestedDueAt,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });

    return todoId;
  },
});

export const dismissCandidate = mutation({
  args: {
    candidateId: v.id("todoCandidates"),
  },
  handler: async (ctx, args) => {
    const candidate = await ctx.db.get(args.candidateId);
    if (!candidate) {
      return null;
    }

    await ctx.db.patch(candidate._id, {
      status: "dismissed",
      updatedAt: Date.now(),
    });

    return candidate._id;
  },
});
