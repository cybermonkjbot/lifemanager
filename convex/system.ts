import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getConfig, setConfigValue } from "./lib/config";
import { resolveTenantForMutation } from "./lib/tenantSecurity";

const DAY_MS = 24 * 60 * 60 * 1000;
const SPENDING_WINDOWS = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
} as const;

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

export const azureSpendingAnalytics = query({
  args: {
    window: v.optional(v.union(v.literal("7d"), v.literal("30d"), v.literal("90d"), v.literal("all"))),
    runCap: v.optional(v.number()),
    modelLimit: v.optional(v.number()),
    fallbackInputCostPer1MUsd: v.optional(v.number()),
    fallbackOutputCostPer1MUsd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const window = args.window ?? "30d";
    const windowDays = SPENDING_WINDOWS[window];
    const windowStartAt = windowDays === null ? null : now - windowDays * DAY_MS;
    const runCap = Math.min(Math.max(Math.floor(args.runCap ?? 8_000), 100), 20_000);
    const modelLimit = Math.min(Math.max(Math.floor(args.modelLimit ?? 12), 3), 40);
    const fallbackInputCostPer1MUsd =
      Number.isFinite(args.fallbackInputCostPer1MUsd) && (args.fallbackInputCostPer1MUsd ?? 0) >= 0
        ? (args.fallbackInputCostPer1MUsd as number)
        : undefined;
    const fallbackOutputCostPer1MUsd =
      Number.isFinite(args.fallbackOutputCostPer1MUsd) && (args.fallbackOutputCostPer1MUsd ?? 0) >= 0
        ? (args.fallbackOutputCostPer1MUsd as number)
        : undefined;
    const fallbackPricingEnabled = fallbackInputCostPer1MUsd !== undefined && fallbackOutputCostPer1MUsd !== undefined;

    let scannedRuns = 0;
    let includedRuns = 0;
    let successRuns = 0;
    let errorRuns = 0;
    let pricedRuns = 0;
    let fallbackPricedRuns = 0;
    let unpricedRuns = 0;
    let tokenizedRuns = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let estimatedCostUsd = 0;
    let fallbackEstimatedCostUsd = 0;
    let totalLatencyMs = 0;
    let earliestRunAt: number | null = null;
    let latestRunAt: number | null = null;
    let truncated = false;

    const dailyBuckets = new Map<
      number,
      {
        dayStartAt: number;
        runs: number;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimatedCostUsd: number;
      }
    >();
    const modelBuckets = new Map<
      string,
      {
        model: string;
        runs: number;
        successRuns: number;
        errorRuns: number;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimatedCostUsd: number;
        pricedRuns: number;
        tokenizedRuns: number;
        totalLatencyMs: number;
      }
    >();
    const statusBuckets = new Map<
      "success" | "error",
      {
        status: "success" | "error";
        runs: number;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimatedCostUsd: number;
      }
    >();

    const azureRuns = ctx.db
      .query("providerRuns")
      .withIndex("by_provider_and_createdAt", (q) => q.eq("provider", "azure"))
      .order("desc");

    for await (const row of azureRuns) {
      scannedRuns += 1;

      if (windowStartAt !== null && row.createdAt < windowStartAt) {
        break;
      }

      if (includedRuns >= runCap) {
        truncated = true;
        break;
      }

      includedRuns += 1;
      latestRunAt = latestRunAt ?? row.createdAt;
      earliestRunAt = row.createdAt;

      const runInputTokensRaw = row.inputTokens;
      const runOutputTokensRaw = row.outputTokens;
      const runTotalTokensRaw = row.totalTokens;
      const runInputTokens = runInputTokensRaw ?? 0;
      const runOutputTokens = runOutputTokensRaw ?? 0;
      const runTotalTokens = runTotalTokensRaw ?? runInputTokens + runOutputTokens;
      const hasTokenData =
        runTotalTokensRaw !== undefined || runInputTokensRaw !== undefined || runOutputTokensRaw !== undefined;
      const fallbackInputTokensForCost =
        runInputTokensRaw ??
        (runTotalTokensRaw !== undefined && runOutputTokensRaw !== undefined
          ? Math.max(runTotalTokensRaw - runOutputTokensRaw, 0)
          : runTotalTokensRaw ?? 0);
      const fallbackOutputTokensForCost =
        runOutputTokensRaw ??
        (runTotalTokensRaw !== undefined && runInputTokensRaw !== undefined
          ? Math.max(runTotalTokensRaw - runInputTokensRaw, 0)
          : 0);
      const fallbackEstimatedCostForRun =
        fallbackPricingEnabled && hasTokenData
          ? Number(
              (
                (fallbackInputTokensForCost / 1_000_000) * (fallbackInputCostPer1MUsd as number) +
                (fallbackOutputTokensForCost / 1_000_000) * (fallbackOutputCostPer1MUsd as number)
              ).toFixed(8),
            )
          : undefined;
      const runEstimatedCostUsd = row.estimatedCostUsd ?? fallbackEstimatedCostForRun ?? 0;

      if (row.status === "success") {
        successRuns += 1;
      } else {
        errorRuns += 1;
      }
      if (row.estimatedCostUsd !== undefined) {
        pricedRuns += 1;
      } else if (fallbackEstimatedCostForRun !== undefined) {
        fallbackPricedRuns += 1;
        fallbackEstimatedCostUsd += fallbackEstimatedCostForRun;
      } else {
        unpricedRuns += 1;
      }
      if (hasTokenData) {
        tokenizedRuns += 1;
      }

      inputTokens += runInputTokens;
      outputTokens += runOutputTokens;
      totalTokens += runTotalTokens;
      estimatedCostUsd += runEstimatedCostUsd;
      totalLatencyMs += row.latencyMs;

      const dayStartAt = Math.floor(row.createdAt / DAY_MS) * DAY_MS;
      const dailyEntry = dailyBuckets.get(dayStartAt) ?? {
        dayStartAt,
        runs: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      };
      dailyEntry.runs += 1;
      dailyEntry.inputTokens += runInputTokens;
      dailyEntry.outputTokens += runOutputTokens;
      dailyEntry.totalTokens += runTotalTokens;
      dailyEntry.estimatedCostUsd += runEstimatedCostUsd;
      dailyBuckets.set(dayStartAt, dailyEntry);

      const modelEntry = modelBuckets.get(row.model) ?? {
        model: row.model,
        runs: 0,
        successRuns: 0,
        errorRuns: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        pricedRuns: 0,
        tokenizedRuns: 0,
        totalLatencyMs: 0,
      };
      modelEntry.runs += 1;
      if (row.status === "success") {
        modelEntry.successRuns += 1;
      } else {
        modelEntry.errorRuns += 1;
      }
      modelEntry.inputTokens += runInputTokens;
      modelEntry.outputTokens += runOutputTokens;
      modelEntry.totalTokens += runTotalTokens;
      modelEntry.estimatedCostUsd += runEstimatedCostUsd;
      modelEntry.totalLatencyMs += row.latencyMs;
      if (row.estimatedCostUsd !== undefined) {
        modelEntry.pricedRuns += 1;
      }
      if (hasTokenData) {
        modelEntry.tokenizedRuns += 1;
      }
      modelBuckets.set(row.model, modelEntry);

      const statusEntry = statusBuckets.get(row.status) ?? {
        status: row.status,
        runs: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      };
      statusEntry.runs += 1;
      statusEntry.inputTokens += runInputTokens;
      statusEntry.outputTokens += runOutputTokens;
      statusEntry.totalTokens += runTotalTokens;
      statusEntry.estimatedCostUsd += runEstimatedCostUsd;
      statusBuckets.set(row.status, statusEntry);
    }

    const roundedEstimatedCostUsd = Number(estimatedCostUsd.toFixed(8));
    const roundedFallbackEstimatedCostUsd = Number(fallbackEstimatedCostUsd.toFixed(8));
    const avgCostPerRunUsd = includedRuns > 0 ? Number((roundedEstimatedCostUsd / includedRuns).toFixed(8)) : 0;
    const avgCostPer1kTokensUsd =
      totalTokens > 0 ? Number(((roundedEstimatedCostUsd / totalTokens) * 1000).toFixed(8)) : 0;
    const avgLatencyMs = includedRuns > 0 ? Number((totalLatencyMs / includedRuns).toFixed(2)) : 0;

    const daily = Array.from(dailyBuckets.values())
      .sort((a, b) => a.dayStartAt - b.dayStartAt)
      .map((entry) => ({
        ...entry,
        date: new Date(entry.dayStartAt).toISOString().slice(0, 10),
        estimatedCostUsd: Number(entry.estimatedCostUsd.toFixed(8)),
      }));
    const models = Array.from(modelBuckets.values())
      .sort((a, b) => {
        if (b.estimatedCostUsd !== a.estimatedCostUsd) {
          return b.estimatedCostUsd - a.estimatedCostUsd;
        }
        if (b.runs !== a.runs) {
          return b.runs - a.runs;
        }
        return a.model.localeCompare(b.model);
      })
      .slice(0, modelLimit)
      .map((entry) => ({
        model: entry.model,
        runs: entry.runs,
        successRuns: entry.successRuns,
        errorRuns: entry.errorRuns,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        totalTokens: entry.totalTokens,
        estimatedCostUsd: Number(entry.estimatedCostUsd.toFixed(8)),
        pricedRuns: entry.pricedRuns,
        tokenizedRuns: entry.tokenizedRuns,
        avgLatencyMs: entry.runs > 0 ? Number((entry.totalLatencyMs / entry.runs).toFixed(2)) : 0,
      }));
    const statuses = Array.from(statusBuckets.values())
      .sort((a, b) => b.runs - a.runs)
      .map((entry) => ({
        ...entry,
        estimatedCostUsd: Number(entry.estimatedCostUsd.toFixed(8)),
      }));

    return {
      provider: "azure" as const,
      window,
      windowLabel: windowDays === null ? "All time" : `Last ${windowDays} days`,
      windowStartAt,
      generatedAt: now,
      scannedRuns,
      runCap,
      truncated,
      totals: {
        runs: includedRuns,
        successRuns,
        errorRuns,
        successRate: includedRuns > 0 ? successRuns / includedRuns : 0,
        pricedRuns,
        fallbackPricedRuns,
        costedRuns: pricedRuns + fallbackPricedRuns,
        unpricedRuns,
        tokenizedRuns,
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCostUsd: roundedEstimatedCostUsd,
        fallbackEstimatedCostUsd: roundedFallbackEstimatedCostUsd,
        avgCostPerRunUsd,
        avgCostPer1kTokensUsd,
        avgLatencyMs,
      },
      pricing: {
        fallbackPricingEnabled,
        fallbackInputCostPer1MUsd: fallbackInputCostPer1MUsd ?? null,
        fallbackOutputCostPer1MUsd: fallbackOutputCostPer1MUsd ?? null,
      },
      coverage: {
        earliestRunAt,
        latestRunAt,
      },
      daily,
      models,
      statuses,
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
  args: {
    provider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"))),
  },
  handler: async (ctx, args) => {
    const provider = args.provider || "whatsapp";
    let record = await ctx.db
      .query("setupRuntime")
      .withIndex("by_provider", (q) => q.eq("provider", provider))
      .first();
    if (!record && provider === "whatsapp") {
      record = await ctx.db
        .query("setupRuntime")
        .withIndex("by_key", (q) => q.eq("key", "whatsapp"))
        .first();
    }

    return record || null;
  },
});

export const upsertSetupStatus = mutation({
  args: {
    provider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"))),
    status: v.union(
      v.literal("idle"),
      v.literal("starting"),
      v.literal("authenticating"),
      v.literal("qr_ready"),
      v.literal("code_ready"),
      v.literal("challenge_required"),
      v.literal("syncing"),
      v.literal("connected"),
      v.literal("error"),
    ),
    mode: v.union(v.literal("qr"), v.literal("pairing_code"), v.literal("password"), v.literal("challenge_code")),
    message: v.string(),
    qrDataUrl: v.optional(v.string()),
    pairingCode: v.optional(v.string()),
    challengeContactPoint: v.optional(v.string()),
    hasAuth: v.boolean(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const provider = args.provider || "whatsapp";
    let existing = await ctx.db
      .query("setupRuntime")
      .withIndex("by_provider", (q) => q.eq("provider", provider))
      .first();
    if (!existing && provider === "whatsapp") {
      existing = await ctx.db
        .query("setupRuntime")
        .withIndex("by_key", (q) => q.eq("key", "whatsapp"))
        .first();
    }
    const payload = {
      ...args,
      provider,
      key: provider,
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }

    return await ctx.db.insert("setupRuntime", payload);
  },
});

export const reportSetupListener = mutation({
  args: {
    tenantId: v.optional(v.id("tenantAccounts")),
    connectorTokenHash: v.optional(v.string()),
    provider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"))),
    listenerActive: v.boolean(),
    listenerWorkerId: v.optional(v.string()),
    listenerMessage: v.optional(v.string()),
    listenerLastSeenAt: v.optional(v.number()),
    hasAuth: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForMutation(ctx, args);
    const provider = args.provider || "whatsapp";
    let existing = tenantId
      ? await ctx.db
          .query("setupRuntime")
          .withIndex("by_tenantId_and_provider", (q) => q.eq("tenantId", tenantId).eq("provider", provider))
          .first()
      : await ctx.db
          .query("setupRuntime")
          .withIndex("by_provider", (q) => q.eq("provider", provider))
          .first();
    if (!existing && !tenantId && provider === "whatsapp") {
      existing = await ctx.db
        .query("setupRuntime")
        .withIndex("by_key", (q) => q.eq("key", "whatsapp"))
        .first();
    }

    const now = Date.now();
    const patch = {
      tenantId,
      provider,
      key: provider,
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
      status: "idle",
      mode: provider === "instagram" ? "password" : "qr",
      message: args.listenerActive
        ? provider === "instagram"
          ? "Worker connected to Instagram."
          : "Worker connected to WhatsApp."
        : "Setup not started.",
      hasAuth: args.hasAuth ?? false,
      ...patch,
    });
  },
});
