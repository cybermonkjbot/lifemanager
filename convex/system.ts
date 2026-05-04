import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getConfig, setConfigValue } from "./lib/config";
import { assertTenantBillingActive, isTenantBillingActive, tenantBillingInactiveReason } from "./lib/billingAccess";
import { resolveTenantForMutation, resolveTenantForQuery } from "./lib/tenantSecurity";

const DAY_MS = 24 * 60 * 60 * 1000;
const SPENDING_WINDOWS = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
} as const;

function readAdminSecret() {
  return process.env.ODOGWU_CONVEX_ADMIN_SECRET || process.env.ODOGWU_ADMIN_SECRET || process.env.SLM_ADMIN_SECRET || "";
}

function requireAdmin(adminSecret: string) {
  const expected = readAdminSecret();
  if (!expected || adminSecret !== expected) {
    throw new Error("Unauthorized.");
  }
}

const tenantScopeArgs = {
  tenantId: v.optional(v.id("tenantAccounts")),
  connectorTokenHash: v.optional(v.string()),
};

async function getProviderConnectionHistory(
  ctx: QueryCtx,
  tenantId: Id<"tenantAccounts"> | undefined,
  provider: "whatsapp" | "instagram" | "imessage" | "telegram",
) {
  const history: {
    hasConnectedBefore: boolean;
    hasActiveConnection: boolean;
    lastConnectedAt?: number;
    lastDisconnectedAt?: number;
    lastConnectionSeenAt?: number;
  } = {
    hasConnectedBefore: false,
    hasActiveConnection: false,
  };

  if (tenantId) {
    const accounts = await ctx.db
      .query("tenantConnectedAccounts")
      .withIndex("by_tenantId_and_provider", (q) => q.eq("tenantId", tenantId).eq("provider", provider))
      .take(25);

    for (const account of accounts) {
      if (account.connectedAt !== undefined || account.authState === "connected") {
        history.hasConnectedBefore = true;
      }
      if (account.authState === "connected") {
        history.hasActiveConnection = true;
        history.lastConnectionSeenAt = Math.max(history.lastConnectionSeenAt ?? 0, account.lastSeenAt ?? account.updatedAt);
      }
      if (account.connectedAt !== undefined) {
        history.lastConnectedAt = Math.max(history.lastConnectedAt ?? 0, account.connectedAt);
      }
      if (account.disconnectedAt !== undefined) {
        history.lastDisconnectedAt = Math.max(history.lastDisconnectedAt ?? 0, account.disconnectedAt);
      }
    }
  }

  if (!history.hasConnectedBefore) {
    const providerCandidates = provider === "whatsapp" ? ([provider, undefined] as const) : ([provider] as const);
    for (const threadProvider of providerCandidates) {
      const existingThread = tenantId
        ? await ctx.db
            .query("threads")
            .withIndex("by_tenantId_and_provider_and_jid", (q) => q.eq("tenantId", tenantId).eq("provider", threadProvider))
            .first()
        : await ctx.db
            .query("threads")
            .withIndex("by_provider_and_lastMessageAt", (q) => q.eq("provider", threadProvider))
            .first();

      if (existingThread) {
        history.hasConnectedBefore = true;
        history.lastConnectedAt = Math.max(history.lastConnectedAt ?? 0, existingThread.lastMessageAt || existingThread.updatedAt);
        break;
      }
    }
  }

  return history;
}

function providerLabel(provider: "whatsapp" | "instagram" | "imessage" | "telegram") {
  if (provider === "instagram") {
    return "Instagram";
  }
  if (provider === "imessage") {
    return "iMessage";
  }
  if (provider === "telegram") {
    return "Telegram";
  }
  return "WhatsApp";
}

function providerSetupMode(provider: "whatsapp" | "instagram" | "imessage" | "telegram") {
  if (provider === "instagram") {
    return "password" as const;
  }
  if (provider === "imessage") {
    return "local" as const;
  }
  if (provider === "telegram") {
    return "phone_code" as const;
  }
  return "qr" as const;
}

async function resolveTenantForOptionalQuery(
  ctx: QueryCtx,
  args: { tenantId?: Id<"tenantAccounts">; connectorTokenHash?: string },
) {
  if (args.connectorTokenHash) {
    return await resolveTenantForQuery(ctx, args);
  }
  return args.tenantId;
}

async function resolveTenantForOptionalMutation(
  ctx: MutationCtx,
  args: { tenantId?: Id<"tenantAccounts">; connectorTokenHash?: string },
) {
  if (args.connectorTokenHash) {
    return await resolveTenantForMutation(ctx, args);
  }
  await assertTenantBillingActive(ctx, args.tenantId);
  return args.tenantId;
}

async function getOutboxRowsByTenantAndStatus(
  ctx: QueryCtx,
  tenantId: Id<"tenantAccounts">,
  status: "pending" | "failed",
  limit: number,
) {
  const rows = await Promise.all(
    (["whatsapp", "instagram", undefined] as const).map((messageProvider) =>
      ctx.db
        .query("outbox")
        .withIndex("by_tenantId_and_messageProvider_and_status_and_sendAt", (q) =>
          q.eq("tenantId", tenantId).eq("messageProvider", messageProvider).eq("status", status),
        )
        .order(status === "pending" ? "asc" : "desc")
        .take(limit),
    ),
  );
  return rows.flat().sort((a, b) => (status === "pending" ? a.sendAt - b.sendAt : b.sendAt - a.sendAt)).slice(0, limit);
}

function withoutTenantScope<T extends { tenantId?: Id<"tenantAccounts">; connectorTokenHash?: string }>(args: T) {
  const payload = { ...args };
  delete payload.tenantId;
  delete payload.connectorTokenHash;
  return payload;
}

async function getTenantBillingBlock(ctx: QueryCtx | MutationCtx, tenantId: Id<"tenantAccounts"> | undefined) {
  if (!tenantId) {
    return null;
  }
  const tenant = await ctx.db.get(tenantId);
  if (!tenant || isTenantBillingActive(tenant)) {
    return null;
  }
  return {
    status: tenant.billingStatus,
    reason: tenantBillingInactiveReason(tenant),
  };
}

async function readSetupStatusSnapshot(
  ctx: QueryCtx,
  tenantId: Id<"tenantAccounts"> | undefined,
  provider: "whatsapp" | "instagram" | "imessage" | "telegram",
) {
  const connectionHistory = await getProviderConnectionHistory(ctx, tenantId, provider);
  let record = tenantId
    ? await ctx.db
        .query("setupRuntime")
        .withIndex("by_tenantId_and_provider", (q) => q.eq("tenantId", tenantId).eq("provider", provider))
        .first()
    : await ctx.db
        .query("setupRuntime")
        .withIndex("by_provider", (q) => q.eq("provider", provider))
        .first();
  if (!record && !tenantId && provider === "whatsapp") {
    record = await ctx.db
      .query("setupRuntime")
      .withIndex("by_key", (q) => q.eq("key", "whatsapp"))
      .first();
  }

  if (record) {
    if (connectionHistory.hasActiveConnection && (record.listenerActive !== true || record.hasAuth !== true)) {
      return {
        ...record,
        status: "connected" as const,
        message: `${providerLabel(provider)} connected.`,
        hasAuth: true,
        listenerActive: true,
        listenerLastSeenAt: connectionHistory.lastConnectionSeenAt ?? record.listenerLastSeenAt,
        updatedAt: Math.max(record.updatedAt, connectionHistory.lastConnectionSeenAt ?? 0),
        ...connectionHistory,
      };
    }
    return {
      ...record,
      ...connectionHistory,
    };
  }

  if (connectionHistory.hasConnectedBefore) {
    const syntheticRecord = {
      key: provider,
      provider,
      status: connectionHistory.hasActiveConnection ? ("connected" as const) : ("idle" as const),
      mode: providerSetupMode(provider),
      message: connectionHistory.hasActiveConnection ? `${providerLabel(provider)} connected.` : "Setup not started.",
      hasAuth: connectionHistory.hasActiveConnection,
      listenerActive: connectionHistory.hasActiveConnection ? true : undefined,
      listenerLastSeenAt: connectionHistory.lastConnectionSeenAt,
      updatedAt:
        connectionHistory.lastConnectionSeenAt ||
        connectionHistory.lastDisconnectedAt ||
        connectionHistory.lastConnectedAt ||
        Date.now(),
      ...connectionHistory,
    };
    return tenantId ? { ...syntheticRecord, tenantId } : syntheticRecord;
  }

  return null;
}

function isProviderConnected(setup: {
  status?: string;
  hasAuth?: boolean;
  listenerActive?: boolean;
} | null) {
  return Boolean(setup?.hasAuth || setup?.listenerActive || setup?.status === "connected");
}

export const health = query({
  args: tenantScopeArgs,
  handler: async (ctx, args) => {
    const now = Date.now();
    const tenantId = await resolveTenantForOptionalQuery(ctx, args);
    const rawConfig = await getConfig(ctx, tenantId);
    const billingBlock = await getTenantBillingBlock(ctx, tenantId);
    const config = billingBlock ? { ...rawConfig, autonomyPaused: true } : rawConfig;
    const latestEvents = tenantId
      ? await ctx.db
          .query("systemEvents")
          .withIndex("by_tenantId_and_createdAt", (q) => q.eq("tenantId", tenantId))
          .order("desc")
          .take(30)
      : await ctx.db
          .query("systemEvents")
          .withIndex("by_createdAt")
          .order("desc")
          .take(30);
    const transcriptionEventWindow = tenantId
      ? await ctx.db
          .query("systemEvents")
          .withIndex("by_tenantId_and_createdAt", (q) => q.eq("tenantId", tenantId))
          .order("desc")
          .take(220)
      : await ctx.db.query("systemEvents").withIndex("by_createdAt").order("desc").take(220);
    const latestTranscriptions = transcriptionEventWindow
      .filter((event) => event.eventType.startsWith("inbound.audio.transcription") || event.eventType === "inbound.audio.transcribed")
      .slice(0, 40);

    const latestProviderRuns = tenantId
      ? await ctx.db
          .query("providerRuns")
          .withIndex("by_tenantId_and_createdAt", (q) => q.eq("tenantId", tenantId))
          .order("desc")
          .take(12)
      : await ctx.db
          .query("providerRuns")
          .withIndex("by_createdAt")
          .order("desc")
          .take(12);
    const followupSourceWindow = tenantId
      ? await ctx.db
          .query("systemEvents")
          .withIndex("by_tenantId_and_createdAt", (q) => q.eq("tenantId", tenantId))
          .order("desc")
          .take(900)
      : await ctx.db.query("systemEvents").withIndex("by_createdAt").order("desc").take(900);
    const followupEventWindow = followupSourceWindow
      .filter((event) => event.eventType.startsWith("followup."))
      .slice(0, 500);

    const providerWindow = tenantId
      ? await ctx.db
          .query("providerRuns")
          .withIndex("by_tenantId_and_createdAt", (q) => q.eq("tenantId", tenantId))
          .order("desc")
          .take(240)
      : await ctx.db
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

    const openGuardrailWindow = await ctx.db
      .query("guardrailEvents")
      .withIndex("by_resolvedAt_and_createdAt", (q) => q.eq("resolvedAt", undefined))
      .order("desc")
      .take(300);
    const openGuardrails = tenantId
      ? (
          await Promise.all(
            openGuardrailWindow.map(async (event) => {
              if (!event.threadId) {
                return null;
              }
              const thread = await ctx.db.get(event.threadId);
              return thread?.tenantId === tenantId ? event : null;
            }),
          )
        ).filter((event): event is (typeof openGuardrailWindow)[number] => Boolean(event))
      : openGuardrailWindow;
    const pendingOutbox = tenantId
      ? await getOutboxRowsByTenantAndStatus(ctx, tenantId, "pending", 250)
      : await ctx.db
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
    const failedOutbox = tenantId
      ? await getOutboxRowsByTenantAndStatus(ctx, tenantId, "failed", 120)
      : await ctx.db
          .query("outbox")
          .withIndex("by_status_sendAt", (q) => q.eq("status", "failed"))
          .order("desc")
          .take(120);
    const overdueSuggested = tenantId
      ? await ctx.db
          .query("followUps")
          .withIndex("by_tenantId_and_status_and_dueAt", (q) => q.eq("tenantId", tenantId).eq("status", "suggested").lte("dueAt", now))
          .take(260)
      : await ctx.db
          .query("followUps")
          .withIndex("by_status_dueAt", (q) => q.eq("status", "suggested").lte("dueAt", now))
          .take(260);
    const overdueConfirmed = tenantId
      ? await ctx.db
          .query("followUps")
          .withIndex("by_tenantId_and_status_and_dueAt", (q) => q.eq("tenantId", tenantId).eq("status", "confirmed").lte("dueAt", now))
          .take(260)
      : await ctx.db
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
      billing: billingBlock
        ? {
            blocked: true,
            status: billingBlock.status,
            reason: billingBlock.reason,
          }
        : {
            blocked: false,
          },
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

export const runtimeStatus = query({
  args: tenantScopeArgs,
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForOptionalQuery(ctx, args);
    const [config, billingBlock, whatsapp, instagram, imessage, telegram] = await Promise.all([
      getConfig(ctx, tenantId),
      getTenantBillingBlock(ctx, tenantId),
      readSetupStatusSnapshot(ctx, tenantId, "whatsapp"),
      readSetupStatusSnapshot(ctx, tenantId, "instagram"),
      readSetupStatusSnapshot(ctx, tenantId, "imessage"),
      readSetupStatusSnapshot(ctx, tenantId, "telegram"),
    ]);

    const autonomyPaused = billingBlock ? true : config.autonomyPaused;

    return {
      autonomyPaused,
      billing: billingBlock
        ? {
            blocked: true,
            status: billingBlock.status,
            reason: billingBlock.reason,
          }
        : {
            blocked: false,
          },
      providers: {
        whatsapp,
        instagram,
        imessage,
        telegram,
      },
      anyWorkerConnected:
        whatsapp?.listenerActive === true ||
        instagram?.listenerActive === true ||
        imessage?.listenerActive === true ||
        telegram?.listenerActive === true,
      instagramConnected: isProviderConnected(instagram),
      imessageConnected: isProviderConnected(imessage),
      telegramConnected: isProviderConnected(telegram),
    };
  },
});

export const azureSpendingAnalytics = query({
  args: {
    ...tenantScopeArgs,
    window: v.optional(v.union(v.literal("7d"), v.literal("30d"), v.literal("90d"), v.literal("all"))),
    runCap: v.optional(v.number()),
    modelLimit: v.optional(v.number()),
    fallbackInputCostPer1MUsd: v.optional(v.number()),
    fallbackOutputCostPer1MUsd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tenantId = await resolveTenantForOptionalQuery(ctx, args);
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

    const azureRuns = tenantId
      ? ctx.db
          .query("providerRuns")
          .withIndex("by_tenantId_and_createdAt", (q) => q.eq("tenantId", tenantId))
          .order("desc")
      : ctx.db
          .query("providerRuns")
          .withIndex("by_provider_and_createdAt", (q) => q.eq("provider", "azure"))
          .order("desc");

    for await (const row of azureRuns) {
      scannedRuns += 1;

      if (tenantId && row.provider !== "azure") {
        continue;
      }

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

export const adminOverviewMetrics = query({
  args: {
    adminSecret: v.string(),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const days = Math.min(Math.max(Math.floor(args.days ?? 14), 7), 30);
    const now = Date.now();
    const todayStartAt = Math.floor(now / DAY_MS) * DAY_MS;
    const startAt = todayStartAt - (days - 1) * DAY_MS;
    const buckets = new Map<
      number,
      {
        dayStartAt: number;
        inboundMessages: number;
        outboundMessages: number;
        totalMessages: number;
        aiRuns: number;
        aiErrors: number;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimatedCostUsd: number;
      }
    >();

    for (let index = 0; index < days; index += 1) {
      const dayStartAt = startAt + index * DAY_MS;
      buckets.set(dayStartAt, {
        dayStartAt,
        inboundMessages: 0,
        outboundMessages: 0,
        totalMessages: 0,
        aiRuns: 0,
        aiErrors: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      });
    }

    let scannedMessages = 0;
    for await (const message of ctx.db.query("messages").withIndex("by_createdAt").order("desc")) {
      if (message.createdAt < startAt) {
        break;
      }
      scannedMessages += 1;
      if (scannedMessages > 30_000) {
        break;
      }
      const dayStartAt = Math.floor(message.createdAt / DAY_MS) * DAY_MS;
      const bucket = buckets.get(dayStartAt);
      if (!bucket) {
        continue;
      }
      bucket.totalMessages += 1;
      if (message.direction === "inbound") {
        bucket.inboundMessages += 1;
      } else {
        bucket.outboundMessages += 1;
      }
    }

    let scannedRuns = 0;
    for await (const run of ctx.db.query("providerRuns").withIndex("by_createdAt").order("desc")) {
      if (run.createdAt < startAt) {
        break;
      }
      scannedRuns += 1;
      if (scannedRuns > 30_000) {
        break;
      }
      const dayStartAt = Math.floor(run.createdAt / DAY_MS) * DAY_MS;
      const bucket = buckets.get(dayStartAt);
      if (!bucket) {
        continue;
      }
      bucket.aiRuns += 1;
      if (run.status === "error") {
        bucket.aiErrors += 1;
      }
      const inputTokens = run.inputTokens || 0;
      const outputTokens = run.outputTokens || 0;
      bucket.inputTokens += inputTokens;
      bucket.outputTokens += outputTokens;
      bucket.totalTokens += run.totalTokens ?? inputTokens + outputTokens;
      bucket.estimatedCostUsd += run.estimatedCostUsd || 0;
    }

    const daily = Array.from(buckets.values()).map((bucket) => ({
      ...bucket,
      date: new Date(bucket.dayStartAt).toISOString().slice(0, 10),
      estimatedCostUsd: Number(bucket.estimatedCostUsd.toFixed(8)),
    }));

    return {
      days,
      startAt,
      generatedAt: now,
      scannedMessages,
      scannedRuns,
      totals: daily.reduce(
        (totals, bucket) => ({
          inboundMessages: totals.inboundMessages + bucket.inboundMessages,
          outboundMessages: totals.outboundMessages + bucket.outboundMessages,
          totalMessages: totals.totalMessages + bucket.totalMessages,
          aiRuns: totals.aiRuns + bucket.aiRuns,
          aiErrors: totals.aiErrors + bucket.aiErrors,
          inputTokens: totals.inputTokens + bucket.inputTokens,
          outputTokens: totals.outputTokens + bucket.outputTokens,
          totalTokens: totals.totalTokens + bucket.totalTokens,
          estimatedCostUsd: Number((totals.estimatedCostUsd + bucket.estimatedCostUsd).toFixed(8)),
        }),
        {
          inboundMessages: 0,
          outboundMessages: 0,
          totalMessages: 0,
          aiRuns: 0,
          aiErrors: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
        },
      ),
      daily,
    };
  },
});

export const logFeed = query({
  args: {
    ...tenantScopeArgs,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForOptionalQuery(ctx, args);
    const limit = Math.min(args.limit ?? 60, 200);
    const providerLimit = Math.max(10, Math.ceil(limit / 2));

    const latestEvents = tenantId
      ? await ctx.db
          .query("systemEvents")
          .withIndex("by_tenantId_and_createdAt", (q) => q.eq("tenantId", tenantId))
          .order("desc")
          .take(limit)
      : await ctx.db
          .query("systemEvents")
          .withIndex("by_createdAt")
          .order("desc")
          .take(limit);

    const latestProviderRuns = tenantId
      ? await ctx.db
          .query("providerRuns")
          .withIndex("by_tenantId_and_createdAt", (q) => q.eq("tenantId", tenantId))
          .order("desc")
          .take(providerLimit)
      : await ctx.db
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
    ...tenantScopeArgs,
    source: v.union(v.literal("worker"), v.literal("convex"), v.literal("dashboard"), v.literal("ai")),
    eventType: v.string(),
    detail: v.string(),
    threadId: v.optional(v.id("threads")),
    toolRunId: v.optional(v.string()),
    outboxId: v.optional(v.id("outbox")),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForOptionalMutation(ctx, args);
    return await ctx.db.insert("systemEvents", {
      ...withoutTenantScope(args),
      tenantId,
      createdAt: Date.now(),
    });
  },
});

export const recordProviderRun = mutation({
  args: {
    ...tenantScopeArgs,
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
    const tenantId = await resolveTenantForOptionalMutation(ctx, args);
    return await ctx.db.insert("providerRuns", {
      ...withoutTenantScope(args),
      tenantId,
      createdAt: Date.now(),
    });
  },
});

export const recordToolRun = mutation({
  args: {
    ...tenantScopeArgs,
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
    const tenantId = await resolveTenantForOptionalMutation(ctx, args);
    return await ctx.db.insert("toolRuns", {
      ...withoutTenantScope(args),
      tenantId,
      createdAt: Date.now(),
    });
  },
});

export const pauseAutonomy = mutation({
  args: tenantScopeArgs,
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForOptionalMutation(ctx, args);
    await setConfigValue(ctx, "autonomyPaused", "true", tenantId);
    await ctx.db.insert("systemEvents", {
      tenantId,
      source: "dashboard",
      eventType: "autonomy.paused",
      detail: "Autonomy manually paused by operator.",
      createdAt: Date.now(),
    });
    return true;
  },
});

export const resumeAutonomy = mutation({
  args: tenantScopeArgs,
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForOptionalMutation(ctx, args);
    const billingBlock = await getTenantBillingBlock(ctx, tenantId);
    if (billingBlock) {
      await setConfigValue(ctx, "autonomyPaused", "true", tenantId);
      await ctx.db.insert("systemEvents", {
        tenantId,
        source: "dashboard",
        eventType: "autonomy.resume_blocked.billing",
        detail: billingBlock.reason,
        createdAt: Date.now(),
      });
      throw new Error(`${billingBlock.reason} Restore billing before enabling automation.`);
    }

    await setConfigValue(ctx, "autonomyPaused", "false", tenantId);
    await ctx.db.insert("systemEvents", {
      tenantId,
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
    ...tenantScopeArgs,
    provider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"), v.literal("imessage"), v.literal("telegram"))),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForOptionalQuery(ctx, args);
    const provider = args.provider || "whatsapp";
    return await readSetupStatusSnapshot(ctx, tenantId, provider);
  },
});

export const upsertSetupStatus = mutation({
  args: {
    ...tenantScopeArgs,
    provider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"), v.literal("imessage"), v.literal("telegram"))),
    status: v.union(
      v.literal("idle"),
      v.literal("starting"),
      v.literal("authenticating"),
      v.literal("qr_ready"),
      v.literal("code_ready"),
      v.literal("challenge_required"),
      v.literal("connecting"),
      v.literal("syncing"),
      v.literal("connected"),
      v.literal("error"),
    ),
    mode: v.union(
      v.literal("qr"),
      v.literal("pairing_code"),
      v.literal("password"),
      v.literal("challenge_code"),
      v.literal("local"),
      v.literal("phone_code"),
    ),
    message: v.string(),
    qrDataUrl: v.optional(v.string()),
    pairingCode: v.optional(v.string()),
    challengeContactPoint: v.optional(v.string()),
    hasAuth: v.boolean(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const provider = args.provider || "whatsapp";
    const tenantId = args.connectorTokenHash ? await resolveTenantForMutation(ctx, args) : undefined;
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
    const payload = {
      ...withoutTenantScope(args),
      tenantId,
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
    provider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"), v.literal("imessage"), v.literal("telegram"))),
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
      mode: providerSetupMode(provider),
      message: args.listenerActive
        ? `Worker connected to ${providerLabel(provider)}.`
        : "Setup not started.",
      hasAuth: args.hasAuth ?? false,
      ...patch,
    });
  },
});
