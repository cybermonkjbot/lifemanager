import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import {
  buildConversationQualityDedupeKey,
  buildConversationQualityThreadSample,
  sanitizeAnalyzerFinding,
  type AnalyzerFinding,
  type QualityMessageSnapshot,
  type QualityThreadCandidate,
} from "./lib/conversationQuality";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_THREAD_LIMIT = 30;
const MAX_THREAD_LIMIT = 30;
const CANDIDATE_THREAD_SCAN_LIMIT = 160;
const PER_THREAD_MESSAGE_LIMIT = 80;
const FINDING_DEDUPE_WINDOW_MS = 30 * DAY_MS;

export const runDailyRef = makeFunctionReference<"action">("conversationQualityActions:runDaily");

const evidenceValidator = v.object({
  threadId: v.optional(v.id("threads")),
  threadTitle: v.optional(v.string()),
  messageId: v.optional(v.id("messages")),
  messageAt: v.optional(v.number()),
  excerpt: v.string(),
});

const analyzerFindingValidator = v.object({
  category: v.string(),
  severity: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
  title: v.string(),
  problemStatement: v.string(),
  evidenceSummary: v.string(),
  evidence: v.array(evidenceValidator),
  suggestedFixPrompt: v.string(),
});

function readAdminSecret() {
  return process.env.ODOGWU_CONVEX_ADMIN_SECRET || process.env.ODOGWU_ADMIN_SECRET || process.env.SLM_ADMIN_SECRET || "";
}

function requireAdmin(adminSecret: string) {
  const expected = readAdminSecret();
  if (!expected || adminSecret !== expected) {
    throw new Error("Unauthorized.");
  }
}

function clampLimit(limit: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(limit)) {
    return fallback;
  }
  return Math.max(1, Math.min(Math.round(limit || fallback), max));
}

function cleanTitle(thread: Pick<Doc<"threads">, "title" | "jid">) {
  return (thread.title || "").trim() || thread.jid;
}

function compactError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 900);
}

function evidenceForStorage(entry: AnalyzerFinding["evidence"][number]) {
  return {
    ...(entry.threadId ? { threadId: entry.threadId } : {}),
    ...(entry.threadTitle ? { threadTitle: entry.threadTitle } : {}),
    ...(entry.messageId ? { messageId: entry.messageId } : {}),
    ...(typeof entry.messageAt === "number" && Number.isFinite(entry.messageAt) ? { messageAt: entry.messageAt } : {}),
    excerpt: entry.excerpt,
  };
}

async function insertOrSkipFinding(ctx: MutationCtx, args: { runId: Id<"conversationQualityRuns">; finding: AnalyzerFinding; now: number }) {
  const dedupeKey = buildConversationQualityDedupeKey(args.finding);
  const recentMatches = await ctx.db
    .query("conversationQualityFindings")
    .withIndex("by_dedupeKey_and_createdAt", (q) => q.eq("dedupeKey", dedupeKey).gte("createdAt", args.now - FINDING_DEDUPE_WINDOW_MS))
    .order("desc")
    .take(6);
  const activeDuplicate = recentMatches.find((row) => row.status !== "dismissed");
  if (activeDuplicate) {
    await ctx.db.patch(activeDuplicate._id, {
      updatedAt: args.now,
      runId: args.runId,
    });
    return { inserted: false, findingId: activeDuplicate._id };
  }

  const findingId = await ctx.db.insert("conversationQualityFindings", {
    runId: args.runId,
    dedupeKey,
    category: args.finding.category,
    severity: args.finding.severity,
    title: args.finding.title,
    problemStatement: args.finding.problemStatement,
    evidenceSummary: args.finding.evidenceSummary,
    evidence: args.finding.evidence.map(evidenceForStorage),
    suggestedFixPrompt: args.finding.suggestedFixPrompt,
    status: "open",
    createdAt: args.now,
    updatedAt: args.now,
  });
  return { inserted: true, findingId };
}

export const buildDailySample = internalQuery({
  args: {
    windowStartAt: v.number(),
    windowEndAt: v.number(),
    maxThreads: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxThreads = clampLimit(args.maxThreads, DEFAULT_THREAD_LIMIT, MAX_THREAD_LIMIT);
    const recentThreads = await ctx.db.query("threads").withIndex("by_lastMessageAt").order("desc").take(CANDIDATE_THREAD_SCAN_LIMIT);
    const candidates: QualityThreadCandidate[] = [];

    for (const thread of recentThreads) {
      if (thread.lastMessageAt < args.windowStartAt) {
        continue;
      }
      if (thread.isIgnored || thread.isArchived || thread.isGroup || thread.threadKind === "group" || thread.threadKind === "broadcast_or_system") {
        continue;
      }

      const rows = await ctx.db
        .query("messages")
        .withIndex("by_thread_messageAt", (q) => q.eq("threadId", thread._id).gte("messageAt", args.windowStartAt))
        .order("desc")
        .take(PER_THREAD_MESSAGE_LIMIT);
      if (rows.length === 0) {
        continue;
      }

      const messages: QualityMessageSnapshot[] = rows
        .map((row) => ({
          messageId: row._id,
          threadId: row.threadId,
          direction: row.direction,
          senderJid: row.senderJid,
          text: row.text,
          ...(row.toolRunId ? { toolRunId: row.toolRunId } : {}),
          messageAt: row.messageAt,
          ...(row.messageType ? { messageType: row.messageType } : {}),
          ...(row.isStatus ? { isStatus: row.isStatus } : {}),
        }))
        .sort((a, b) => a.messageAt - b.messageAt);

      const feedbackRows = await ctx.db
        .query("aiFeedbackSignals")
        .withIndex("by_threadId_and_createdAt", (q) => q.eq("threadId", thread._id).gte("createdAt", args.windowStartAt))
        .take(20);
      const negativeFeedbackCount = feedbackRows.filter((row) => row.score < 0).length;

      candidates.push({
        threadId: thread._id,
        title: cleanTitle(thread),
        ...(thread.provider ? { provider: thread.provider } : {}),
        lastMessageAt: thread.lastMessageAt,
        messages,
        negativeFeedbackCount,
      });
    }

    const selectedThreads = candidates
      .map(buildConversationQualityThreadSample)
      .filter((sample): sample is NonNullable<typeof sample> => Boolean(sample))
      .sort((a, b) => b.score - a.score || b.lastMessageAt - a.lastMessageAt)
      .slice(0, maxThreads);

    return {
      windowStartAt: args.windowStartAt,
      windowEndAt: args.windowEndAt,
      selectedThreads,
      candidateThreadCount: candidates.length,
    };
  },
});

export const startRun = internalMutation({
  args: {
    windowStartAt: v.number(),
    windowEndAt: v.number(),
    model: v.optional(v.string()),
    selectedThreadCount: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("conversationQualityRuns", {
      windowStartAt: args.windowStartAt,
      windowEndAt: args.windowEndAt,
      status: "running",
      ...(args.model ? { model: args.model } : {}),
      selectedThreadCount: args.selectedThreadCount,
      analyzedThreadCount: 0,
      findingCount: 0,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const completeRun = internalMutation({
  args: {
    runId: v.id("conversationQualityRuns"),
    model: v.optional(v.string()),
    status: v.union(v.literal("success"), v.literal("warning"), v.literal("error")),
    analyzedThreadCount: v.number(),
    errorMessage: v.optional(v.string()),
    findings: v.array(analyzerFindingValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let insertedCount = 0;
    for (const rawFinding of args.findings) {
      const finding = sanitizeAnalyzerFinding(rawFinding);
      if (!finding) {
        continue;
      }
      const result = await insertOrSkipFinding(ctx, { runId: args.runId, finding, now });
      if (result.inserted) {
        insertedCount += 1;
      }
    }

    await ctx.db.patch(args.runId, {
      status: args.status,
      ...(args.model ? { model: args.model } : {}),
      analyzedThreadCount: args.analyzedThreadCount,
      findingCount: insertedCount,
      ...(args.errorMessage ? { errorMessage: args.errorMessage } : {}),
      finishedAt: now,
      updatedAt: now,
    });
    return { insertedCount };
  },
});

export const failRun = internalMutation({
  args: {
    runId: v.id("conversationQualityRuns"),
    errorMessage: v.string(),
    analyzedThreadCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: "error",
      errorMessage: args.errorMessage.slice(0, 900),
      analyzedThreadCount: Math.max(0, Math.round(args.analyzedThreadCount || 0)),
      finishedAt: now,
      updatedAt: now,
    });
  },
});

export const listForAdmin = query({
  args: {
    adminSecret: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const limit = clampLimit(args.limit, 80, 200);
    const [runs, findings] = await Promise.all([
      ctx.db.query("conversationQualityRuns").withIndex("by_createdAt").order("desc").take(20),
      ctx.db.query("conversationQualityFindings").withIndex("by_createdAt").order("desc").take(limit),
    ]);
    return {
      runs,
      findings,
      fetchedAt: Date.now(),
    };
  },
});

export const dismissFinding = mutation({
  args: {
    adminSecret: v.string(),
    findingId: v.id("conversationQualityFindings"),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const finding = await ctx.db.get(args.findingId);
    if (!finding) {
      throw new Error("Conversation quality finding not found.");
    }
    const now = Date.now();
    await ctx.db.patch(finding._id, {
      status: "dismissed",
      updatedAt: now,
    });
    return { ok: true };
  },
});

export const prepareFindingRun = mutation({
  args: {
    adminSecret: v.string(),
    findingId: v.id("conversationQualityFindings"),
    launchedSelfImproveRunId: v.string(),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const finding = await ctx.db.get(args.findingId);
    if (!finding) {
      throw new Error("Conversation quality finding not found.");
    }
    if (finding.status === "dismissed" || finding.status === "applied") {
      throw new Error(`Finding is ${finding.status}.`);
    }
    const now = Date.now();
    await ctx.db.patch(finding._id, {
      status: "running",
      launchedSelfImproveRunId: args.launchedSelfImproveRunId,
      launchedAt: now,
      updatedAt: now,
    });
    return {
      findingId: finding._id,
      title: finding.title,
      prompt: finding.suggestedFixPrompt,
    };
  },
});

export const markFindingRunFinished = mutation({
  args: {
    adminSecret: v.string(),
    findingId: v.id("conversationQualityFindings"),
    launchedSelfImproveRunId: v.string(),
    success: v.boolean(),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const finding = await ctx.db.get(args.findingId);
    if (!finding) {
      return { ok: false, reason: "missing_finding" };
    }
    if (finding.launchedSelfImproveRunId && finding.launchedSelfImproveRunId !== args.launchedSelfImproveRunId) {
      return { ok: false, reason: "stale_run" };
    }
    const now = Date.now();
    await ctx.db.patch(finding._id, {
      status: args.success ? "applied" : "failed",
      ...(args.errorMessage ? { runError: compactError(args.errorMessage) } : {}),
      finishedAt: now,
      updatedAt: now,
    });
    return { ok: true };
  },
});
