import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getConfig, setConfigValue } from "./lib/config";

export const health = query({
  args: {},
  handler: async (ctx) => {
    const config = await getConfig(ctx);
    const latestEvents = await ctx.db
      .query("systemEvents")
      .withIndex("by_createdAt")
      .order("desc")
      .take(30);

    const latestProviderRuns = await ctx.db
      .query("providerRuns")
      .withIndex("by_createdAt")
      .order("desc")
      .take(12);

    return {
      config,
      latestEvents,
      latestProviderRuns,
    };
  },
});

export const recordEvent = mutation({
  args: {
    source: v.union(v.literal("worker"), v.literal("convex"), v.literal("dashboard"), v.literal("ai")),
    eventType: v.string(),
    detail: v.string(),
    threadId: v.optional(v.id("threads")),
    outboxId: v.optional(v.id("outbox")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("systemEvents", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const recordProviderRun = mutation({
  args: {
    threadId: v.optional(v.id("threads")),
    draftId: v.optional(v.id("replyDrafts")),
    provider: v.union(v.literal("azure"), v.literal("codex"), v.literal("heuristic")),
    model: v.string(),
    latencyMs: v.number(),
    status: v.union(v.literal("success"), v.literal("error")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("providerRuns", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const pauseAutonomy = mutation({
  args: {},
  handler: async (ctx) => {
    await setConfigValue(ctx, "autonomyPaused", "true");
    await ctx.db.insert("systemEvents", {
      source: "dashboard",
      eventType: "autonomy.paused",
      detail: "Autonomy manually paused by operator.",
      createdAt: Date.now(),
    });
    return true;
  },
});

export const resumeAutonomy = mutation({
  args: {},
  handler: async (ctx) => {
    await setConfigValue(ctx, "autonomyPaused", "false");
    await ctx.db.insert("systemEvents", {
      source: "dashboard",
      eventType: "autonomy.resumed",
      detail: "Autonomy manually resumed by operator.",
      createdAt: Date.now(),
    });
    return true;
  },
});

export const setIgnoreGroupsByDefault = mutation({
  args: {
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    await setConfigValue(ctx, "ignoreGroupsByDefault", args.enabled ? "true" : "false");
    return args.enabled;
  },
});
