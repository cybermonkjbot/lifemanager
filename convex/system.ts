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

export const logFeed = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 60, 200);
    const providerLimit = Math.max(10, Math.ceil(limit / 2));

    const latestEvents = await ctx.db
      .query("systemEvents")
      .withIndex("by_createdAt")
      .order("desc")
      .take(limit);

    const latestProviderRuns = await ctx.db
      .query("providerRuns")
      .withIndex("by_createdAt")
      .order("desc")
      .take(providerLimit);

    const eventItems = latestEvents.map((event) => ({
      id: event._id,
      source: event.source,
      eventType: event.eventType,
      detail: event.detail,
      createdAt: event.createdAt,
      kind: "event" as const,
    }));

    const providerItems = latestProviderRuns.map((run) => ({
      id: run._id,
      source: "ai" as const,
      eventType: `provider.${run.provider}.${run.status}`,
      detail: run.error
        ? `${run.model} · ${run.latencyMs}ms · ${run.error.slice(0, 180)}`
        : `${run.model} · ${run.latencyMs}ms`,
      createdAt: run.createdAt,
      kind: "provider" as const,
    }));

    return [...eventItems, ...providerItems]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
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

export const setupStatus = query({
  args: {},
  handler: async (ctx) => {
    const record = await ctx.db
      .query("setupRuntime")
      .withIndex("by_key", (q) => q.eq("key", "whatsapp"))
      .first();

    return record || null;
  },
});

export const upsertSetupStatus = mutation({
  args: {
    status: v.union(
      v.literal("idle"),
      v.literal("starting"),
      v.literal("qr_ready"),
      v.literal("code_ready"),
      v.literal("syncing"),
      v.literal("connected"),
      v.literal("error"),
    ),
    mode: v.union(v.literal("qr"), v.literal("pairing_code")),
    message: v.string(),
    qrDataUrl: v.optional(v.string()),
    pairingCode: v.optional(v.string()),
    hasAuth: v.boolean(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("setupRuntime")
      .withIndex("by_key", (q) => q.eq("key", "whatsapp"))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }

    return await ctx.db.insert("setupRuntime", {
      key: "whatsapp",
      ...args,
    });
  },
});

export const reportSetupListener = mutation({
  args: {
    listenerActive: v.boolean(),
    listenerWorkerId: v.optional(v.string()),
    listenerMessage: v.optional(v.string()),
    listenerLastSeenAt: v.optional(v.number()),
    hasAuth: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("setupRuntime")
      .withIndex("by_key", (q) => q.eq("key", "whatsapp"))
      .first();

    const now = Date.now();
    const patch = {
      listenerActive: args.listenerActive,
      listenerWorkerId: args.listenerWorkerId,
      listenerMessage: args.listenerMessage,
      listenerLastSeenAt: args.listenerLastSeenAt ?? now,
      updatedAt: now,
      ...(args.hasAuth === undefined ? {} : { hasAuth: args.hasAuth }),
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("setupRuntime", {
      key: "whatsapp",
      status: "idle",
      mode: "qr",
      message: args.listenerActive ? "Worker connected to WhatsApp." : "Setup not started.",
      hasAuth: args.hasAuth ?? false,
      ...patch,
    });
  },
});
