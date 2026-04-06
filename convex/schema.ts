import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  appConfig: defineTable({
    key: v.string(),
    value: v.string(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  threads: defineTable({
    jid: v.string(),
    title: v.optional(v.string()),
    isGroup: v.boolean(),
    isIgnored: v.boolean(),
    lastMessageAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_jid", ["jid"])
    .index("by_lastMessageAt", ["lastMessageAt"])
    .index("by_ignored", ["isIgnored"]),

  messages: defineTable({
    threadId: v.id("threads"),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    whatsappMessageId: v.optional(v.string()),
    senderJid: v.string(),
    text: v.string(),
    messageAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_thread_messageAt", ["threadId", "messageAt"])
    .index("by_createdAt", ["createdAt"]),

  threadMemory: defineTable({
    threadId: v.id("threads"),
    summary: v.string(),
    styleNotes: v.array(v.string()),
    updatedAt: v.number(),
  }).index("by_thread", ["threadId"]),

  replyDrafts: defineTable({
    threadId: v.id("threads"),
    sourceMessageId: v.id("messages"),
    text: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("sent"),
      v.literal("rejected"),
      v.literal("snoozed"),
    ),
    confidence: v.number(),
    provider: v.union(v.literal("azure"), v.literal("codex"), v.literal("heuristic")),
    delayMs: v.number(),
    typingMs: v.number(),
    reason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_status", ["status"])
    .index("by_sourceMessage", ["sourceMessageId"]),

  outbox: defineTable({
    threadId: v.id("threads"),
    draftId: v.id("replyDrafts"),
    followUpId: v.optional(v.id("followUps")),
    messageText: v.string(),
    sendAt: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("claimed"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    workerId: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    attempts: v.number(),
    idempotencyKey: v.string(),
    provider: v.union(v.literal("azure"), v.literal("codex"), v.literal("heuristic")),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status_sendAt", ["status", "sendAt"])
    .index("by_status_leaseExpiresAt", ["status", "leaseExpiresAt"])
    .index("by_worker", ["workerId"])
    .index("by_draft", ["draftId"]),

  followUps: defineTable({
    threadId: v.id("threads"),
    sourceMessageId: v.id("messages"),
    reason: v.string(),
    draftText: v.string(),
    dueAt: v.number(),
    status: v.union(
      v.literal("suggested"),
      v.literal("confirmed"),
      v.literal("queued"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status_dueAt", ["status", "dueAt"])
    .index("by_dueAt", ["dueAt"])
    .index("by_thread", ["threadId"]),

  todoCandidates: defineTable({
    threadId: v.id("threads"),
    sourceMessageId: v.id("messages"),
    title: v.string(),
    suggestedDueAt: v.optional(v.number()),
    status: v.union(v.literal("suggested"), v.literal("accepted"), v.literal("dismissed")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_thread", ["threadId"]),

  todos: defineTable({
    threadId: v.optional(v.id("threads")),
    sourceMessageId: v.optional(v.id("messages")),
    title: v.string(),
    dueAt: v.optional(v.number()),
    status: v.union(v.literal("open"), v.literal("done")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_status", ["status"]),

  styleProfiles: defineTable({
    scope: v.union(v.literal("global"), v.literal("thread")),
    threadId: v.optional(v.id("threads")),
    mimicryLevel: v.number(),
    commonPhrases: v.array(v.string()),
    punctuationStyle: v.array(v.string()),
    humorNotes: v.array(v.string()),
    spellingNotes: v.array(v.string()),
    updatedAt: v.number(),
  })
    .index("by_scope", ["scope"])
    .index("by_thread", ["threadId"]),

  ignoreRules: defineTable({
    targetType: v.union(v.literal("contact"), v.literal("group"), v.literal("keyword")),
    targetValue: v.string(),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_target", ["targetType", "targetValue"])
    .index("by_type", ["targetType"]),

  guardrailEvents: defineTable({
    threadId: v.optional(v.id("threads")),
    draftId: v.optional(v.id("replyDrafts")),
    severity: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    reason: v.string(),
    blocked: v.boolean(),
    createdAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),

  providerRuns: defineTable({
    threadId: v.optional(v.id("threads")),
    draftId: v.optional(v.id("replyDrafts")),
    provider: v.union(v.literal("azure"), v.literal("codex"), v.literal("heuristic")),
    model: v.string(),
    latencyMs: v.number(),
    status: v.union(v.literal("success"), v.literal("error")),
    error: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),

  systemEvents: defineTable({
    source: v.union(
      v.literal("worker"),
      v.literal("convex"),
      v.literal("dashboard"),
      v.literal("ai"),
    ),
    eventType: v.string(),
    threadId: v.optional(v.id("threads")),
    outboxId: v.optional(v.id("outbox")),
    detail: v.string(),
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_type", ["eventType"]),

  setupRuntime: defineTable({
    key: v.string(),
    status: v.union(
      v.literal("idle"),
      v.literal("starting"),
      v.literal("qr_ready"),
      v.literal("code_ready"),
      v.literal("connected"),
      v.literal("error"),
    ),
    mode: v.union(v.literal("qr"), v.literal("pairing_code")),
    message: v.string(),
    qrDataUrl: v.optional(v.string()),
    pairingCode: v.optional(v.string()),
    hasAuth: v.boolean(),
    listenerActive: v.optional(v.boolean()),
    listenerWorkerId: v.optional(v.string()),
    listenerMessage: v.optional(v.string()),
    listenerLastSeenAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
});
