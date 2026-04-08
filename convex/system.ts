import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getConfig, setConfigValue } from "./lib/config";

export const health = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const config = await getConfig(ctx);
    const latestEvents = await ctx.db
      .query("systemEvents")
      .withIndex("by_createdAt")
      .order("desc")
      .take(30);
    const latestTranscriptions = (await ctx.db.query("systemEvents").withIndex("by_createdAt").order("desc").take(220))
      .filter((event) => event.eventType.startsWith("inbound.audio.transcription") || event.eventType === "inbound.audio.transcribed")
      .slice(0, 40);

    const latestProviderRuns = await ctx.db
      .query("providerRuns")
      .withIndex("by_createdAt")
      .order("desc")
      .take(12);
    const followupEventWindow = (await ctx.db.query("systemEvents").withIndex("by_createdAt").order("desc").take(900))
      .filter((event) => event.eventType.startsWith("followup."))
      .slice(0, 500);

    const providerWindow = await ctx.db
      .query("providerRuns")
      .withIndex("by_createdAt")
      .order("desc")
      .take(240);
    const successCount = providerWindow.filter((row) => row.status === "success").length;
    const errorCount = providerWindow.filter((row) => row.status === "error").length;
    const totalProviderRuns = providerWindow.length;
    const fallbackCount = providerWindow.filter((row) => row.status === "success" && row.provider !== "azure").length;
    const errorRate = totalProviderRuns > 0 ? errorCount / totalProviderRuns : 0;
    const fallbackRate = successCount > 0 ? fallbackCount / successCount : 0;
    const latencies = providerWindow.map((row) => row.latencyMs).sort((a, b) => a - b);
    const p95LatencyMs = latencies.length > 0 ? latencies[Math.floor((latencies.length - 1) * 0.95)] : 0;
    const inputTokens = providerWindow.reduce((sum, row) => sum + (row.inputTokens || 0), 0);
    const outputTokens = providerWindow.reduce((sum, row) => sum + (row.outputTokens || 0), 0);
    const totalTokens = providerWindow.reduce(
      (sum, row) => sum + (row.totalTokens ?? (row.inputTokens || 0) + (row.outputTokens || 0)),
      0,
    );
    const estimatedCostUsd = Number(providerWindow.reduce((sum, row) => sum + (row.estimatedCostUsd || 0), 0).toFixed(8));
    const tokenizedRuns = providerWindow.filter(
      (row) => row.totalTokens !== undefined || row.inputTokens !== undefined || row.outputTokens !== undefined,
    ).length;
    const pricedRuns = providerWindow.filter((row) => row.estimatedCostUsd !== undefined).length;

    const openGuardrails = await ctx.db
      .query("guardrailEvents")
      .withIndex("by_resolvedAt_and_createdAt", (q) => q.eq("resolvedAt", undefined))
      .order("desc")
      .take(300);
    const pendingOutbox = await ctx.db
      .query("outbox")
      .withIndex("by_status_sendAt", (q) => q.eq("status", "pending"))
      .order("asc")
      .take(250);
    let dueNow = 0;
    for (const row of pendingOutbox) {
      if (row.sendAt > now) {
        break;
      }
      dueNow += 1;
    }
    const failedOutbox = await ctx.db
      .query("outbox")
      .withIndex("by_status_sendAt", (q) => q.eq("status", "failed"))
      .order("desc")
      .take(120);
    const overdueSuggested = await ctx.db
      .query("followUps")
      .withIndex("by_status_dueAt", (q) => q.eq("status", "suggested").lte("dueAt", now))
      .take(260);
    const overdueConfirmed = await ctx.db
      .query("followUps")
      .withIndex("by_status_dueAt", (q) => q.eq("status", "confirmed").lte("dueAt", now))
      .take(260);
    const followupDetected = followupEventWindow.filter((event) => event.eventType === "followup.detected").length;
    const followupConfirmed = followupEventWindow.filter((event) => event.eventType === "followup.confirmed").length;
    const followupDismissed = followupEventWindow.filter((event) => event.eventType === "followup.dismissed").length;
    const followupSent = followupEventWindow.filter((event) => event.eventType === "followup.sent").length;
    const followupFailed = followupEventWindow.filter((event) => event.eventType === "followup.failed").length;
    const detectionBase = Math.max(followupDetected, 1);
    const followupConfirmationRate = followupDetected > 0 ? followupConfirmed / detectionBase : 0;
    const followupDismissalRate = followupDetected > 0 ? followupDismissed / detectionBase : 0;
    const followupOverdueCount = overdueSuggested.length + overdueConfirmed.length;

    const alerts: string[] = [];
    if (errorRate > 0.2 && totalProviderRuns >= 20) {
      alerts.push(`High provider error rate: ${(errorRate * 100).toFixed(1)}% over last ${totalProviderRuns} runs.`);
    }
    if (fallbackRate > 0.45 && successCount >= 20) {
      alerts.push(`Fallback dependency elevated: ${(fallbackRate * 100).toFixed(1)}% of successful runs are non-Azure.`);
    }
    if (openGuardrails.length >= 8) {
      alerts.push(`Guardrail queue is growing (${openGuardrails.length} unresolved flags).`);
    }
    if (dueNow >= 25) {
      alerts.push(`Outbox due queue is elevated (${dueNow} pending sends due now).`);
    }
    if (followupOverdueCount >= 20) {
      alerts.push(`Follow-up overdue queue is elevated (${followupOverdueCount} due reminders awaiting action).`);
    }

    return {
      config,
      latestEvents,
      latestTranscriptions,
      latestProviderRuns,
      metrics: {
        providerRunsWindow: totalProviderRuns,
        providerSuccess: successCount,
        providerErrors: errorCount,
        providerErrorRate: errorRate,
        providerFallbackRate: fallbackRate,
        providerP95LatencyMs: p95LatencyMs,
        providerInputTokens: inputTokens,
        providerOutputTokens: outputTokens,
        providerTotalTokens: totalTokens,
        providerTokenizedRuns: tokenizedRuns,
        providerEstimatedCostUsd: estimatedCostUsd,
        providerPricedRuns: pricedRuns,
        openGuardrails: openGuardrails.length,
        pendingOutbox: pendingOutbox.length,
        dueOutbox: dueNow,
        failedOutboxRecent: failedOutbox.length,
        followupDetections: followupDetected,
        followupConfirmationRate,
        followupDismissalRate,
        followupSent,
        followupFailed,
        followupOverdueCount,
      },
      alerts,
      runbooks: [
        {
          title: "Reconnect Storm",
          key: "reconnect-storm",
          steps:
            "Pause autonomy, restart worker once, verify setup status is connected, then inspect latest system events for repeated socket resets.",
        },
        {
          title: "Provider Outage",
          key: "provider-outage",
          steps:
            "Switch to broader fallback mode, validate test reply in System tab, and monitor provider error rate until stable.",
        },
        {
          title: "Outbox Backlog",
          key: "outbox-backlog",
          steps:
            "Review due queue size, inspect failed outbox rows, and reduce outbound throttles only if policy-safe.",
        },
      ],
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
        ? `${run.model} · ${run.latencyMs}ms${run.totalTokens !== undefined ? ` · ${run.totalTokens} tok` : ""}${run.estimatedCostUsd !== undefined ? ` · $${run.estimatedCostUsd.toFixed(6)}` : ""} · ${run.error.slice(0, 180)}`
        : `${run.model} · ${run.latencyMs}ms${run.totalTokens !== undefined ? ` · ${run.totalTokens} tok` : ""}${run.estimatedCostUsd !== undefined ? ` · $${run.estimatedCostUsd.toFixed(6)}` : ""}`,
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
    toolRunId: v.optional(v.string()),
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
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    usageSource: v.optional(v.union(v.literal("provider"), v.literal("estimated"))),
    estimatedCostUsd: v.optional(v.number()),
    costCurrency: v.optional(v.literal("USD")),
    pricingVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("providerRuns", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const recordToolRun = mutation({
  args: {
    threadId: v.optional(v.id("threads")),
    toolRunId: v.optional(v.string()),
    plannerSource: v.optional(v.union(v.literal("deterministic"), v.literal("hybrid"))),
    plannerConfidence: v.optional(v.number()),
    hintApplied: v.optional(v.boolean()),
    stepId: v.string(),
    toolName: v.string(),
    status: v.union(v.literal("success"), v.literal("error"), v.literal("timeout"), v.literal("skipped")),
    latencyMs: v.number(),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    inputHash: v.optional(v.string()),
    inputSize: v.optional(v.number()),
    outputSize: v.optional(v.number()),
    outputSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("toolRuns", {
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
