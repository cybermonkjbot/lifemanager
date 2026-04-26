import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { judgeActualTodoCandidate } from "./lib/heuristics";
import { isTodoCandidateStale } from "./lib/staleness";

function parseIsoDate(value: string) {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }
  const [yearText, monthText, dayText] = normalized.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  if (
    asUtc.getUTCFullYear() !== year ||
    asUtc.getUTCMonth() !== month - 1 ||
    asUtc.getUTCDate() !== day
  ) {
    return null;
  }
  return normalized;
}

export const list = query({
  args: {
    todoLimit: v.optional(v.number()),
    candidateLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
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
    const activeCandidates = (
      await Promise.all(
        candidates.map(async (candidate) => {
          const [thread, sourceMessage] = await Promise.all([
            ctx.db.get(candidate.threadId),
            ctx.db.get(candidate.sourceMessageId),
          ]);
          const stale = await isTodoCandidateStale({
            ctx,
            candidate,
            thread,
            sourceMessage,
            now,
          });
          return stale ? null : candidate;
        }),
      )
    ).filter((candidate) => candidate !== null);

    return {
      todos,
      candidates: activeCandidates,
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
    const [thread, sourceMessage] = await Promise.all([
      ctx.db.get(candidate.threadId),
      ctx.db.get(candidate.sourceMessageId),
    ]);
    const stale = await isTodoCandidateStale({
      ctx,
      candidate,
      thread,
      sourceMessage,
      now: Date.now(),
    });
    if (stale) {
      await ctx.db.patch(candidate._id, {
        status: "dismissed",
        updatedAt: Date.now(),
      });
      throw new Error("Candidate is stale and was auto-dismissed.");
    }

    const now = Date.now();
    const todoJudge = judgeActualTodoCandidate({
      sourceText: sourceMessage?.text || candidate.title,
      contextText: undefined,
      candidate: {
        title: candidate.title,
        suggestedDueAt: candidate.suggestedDueAt,
      },
    });
    if (todoJudge.decision === "reject") {
      await ctx.db.patch(candidate._id, {
        status: "dismissed",
        updatedAt: now,
      });
      await ctx.db.insert("systemEvents", {
        source: "convex",
        eventType: "todo.detected.judge_rejected",
        threadId: candidate.threadId,
        detail: `${todoJudge.reasonCode} · ${candidate.title}`.slice(0, 240),
        createdAt: now,
      });
      throw new Error("Candidate failed TODO quality judge and was dismissed.");
    }

    await ctx.db.patch(candidate._id, {
      status: "accepted",
      updatedAt: now,
    });

    const todoId = await ctx.db.insert("todos", {
      threadId: candidate.threadId,
      sourceMessageId: candidate.sourceMessageId,
      title: todoJudge.title,
      dueAt: todoJudge.suggestedDueAt,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });

    return todoId;
  },
});

export const createAgendaRange = mutation({
  args: {
    agenda: v.string(),
    entries: v.array(
      v.object({
        date: v.string(),
        dueAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const agenda = args.agenda.trim().replace(/\s+/g, " ");
    if (!agenda) {
      throw new Error("Agenda is required.");
    }
    if (agenda.length > 180) {
      throw new Error("Agenda is too long.");
    }
    if (args.entries.length < 1) {
      throw new Error("Pick at least one day.");
    }
    if (args.entries.length > 180) {
      throw new Error("Range too large; keep it under 180 days.");
    }

    const now = Date.now();
    const seenDates = new Set<string>();
    const todoIds = [];
    for (const entry of args.entries) {
      const date = parseIsoDate(entry.date);
      if (!date) {
        throw new Error("Invalid date in agenda range.");
      }
      if (!Number.isFinite(entry.dueAt) || entry.dueAt <= 0) {
        throw new Error("Invalid due date in agenda range.");
      }
      if (seenDates.has(date)) {
        continue;
      }
      seenDates.add(date);
      const todoId = await ctx.db.insert("todos", {
        title: agenda,
        dueAt: Math.round(entry.dueAt),
        status: "open",
        createdAt: now,
        updatedAt: now,
      });
      todoIds.push(todoId);
    }

    return {
      created: todoIds.length,
      todoIds,
    };
  },
});

export const setTodoStatus = mutation({
  args: {
    todoId: v.id("todos"),
    status: v.union(v.literal("open"), v.literal("done")),
  },
  handler: async (ctx, args) => {
    const todo = await ctx.db.get(args.todoId);
    if (!todo) {
      throw new Error("Todo not found");
    }
    await ctx.db.patch(todo._id, {
      status: args.status,
      updatedAt: Date.now(),
    });
    return todo._id;
  },
});

export const updateCandidateTitle = mutation({
  args: {
    candidateId: v.id("todoCandidates"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const candidate = await ctx.db.get(args.candidateId);
    if (!candidate) {
      throw new Error("Candidate not found");
    }
    if (candidate.status !== "suggested") {
      throw new Error("Candidate is no longer open for review");
    }

    const title = args.title.trim().replace(/\s+/g, " ");
    if (!title) {
      throw new Error("Title is required");
    }
    if (title.length > 180) {
      throw new Error("Title is too long");
    }

    await ctx.db.patch(candidate._id, {
      title,
      updatedAt: Date.now(),
    });

    return candidate._id;
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

export const clearAll = mutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const batchSize = Math.min(Math.max(5, Math.round(args.limit ?? 80)), 200);

    const openTodos = await ctx.db
      .query("todos")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .order("desc")
      .take(batchSize);

    const suggestedCandidates = await ctx.db
      .query("todoCandidates")
      .withIndex("by_status", (q) => q.eq("status", "suggested"))
      .order("desc")
      .take(batchSize);

    for (const todo of openTodos) {
      await ctx.db.patch(todo._id, {
        status: "done",
        updatedAt: now,
      });
    }

    for (const candidate of suggestedCandidates) {
      await ctx.db.patch(candidate._id, {
        status: "dismissed",
        updatedAt: now,
      });
    }

    const clearedTodos = openTodos.length;
    const clearedCandidates = suggestedCandidates.length;
    const cleared = clearedTodos + clearedCandidates;

    if (cleared > 0) {
      await ctx.db.insert("systemEvents", {
        source: "dashboard",
        eventType: "todo.cleared",
        detail: `Cleared ${clearedTodos} open todo(s) and ${clearedCandidates} suggested candidate(s).`,
        createdAt: now,
      });
    }

    return {
      clearedTodos,
      clearedCandidates,
      cleared,
      hasMore: openTodos.length === batchSize || suggestedCandidates.length === batchSize,
    };
  },
});
