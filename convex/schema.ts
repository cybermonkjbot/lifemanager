import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  aiCandidateFeatureVectorValidator,
  aiCandidateScoreBreakdownValidator,
  aiFeedbackMetadataValidator,
  aiFeedbackPathValidator,
  aiOutcomeLabelValidator,
  aiOutcomeSignalCountsValidator,
  aiTuningBoundsProfileValidator,
  aiTuningRerankWeightsValidator,
  aiTuningRetrievalWeightsValidator,
  aiTuningThresholdsValidator,
  contextPackValidator,
  outreachModeValidator,
} from "./lib/aiSmartness";

export default defineSchema({
  appConfig: defineTable({
    key: v.string(),
    value: v.string(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  threads: defineTable({
    provider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"))),
    jid: v.string(),
    title: v.optional(v.string()),
    isGroup: v.boolean(),
    isIgnored: v.boolean(),
    threadKind: v.optional(v.union(v.literal("direct"), v.literal("group"), v.literal("broadcast_or_system"))),
    isArchived: v.optional(v.boolean()),
    archivedAt: v.optional(v.number()),
    ghostedUntil: v.optional(v.number()),
    nightPausedUntil: v.optional(v.number()),
    callReplyBarrierAt: v.optional(v.number()),
    lastMessageAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_jid", ["jid"])
    .index("by_provider_and_jid", ["provider", "jid"])
    .index("by_lastMessageAt", ["lastMessageAt"])
    .index("by_provider_and_lastMessageAt", ["provider", "lastMessageAt"])
    .index("by_threadKind_and_lastMessageAt", ["threadKind", "lastMessageAt"])
    .index("by_provider_and_threadKind_and_lastMessageAt", ["provider", "threadKind", "lastMessageAt"])
    .index("by_ignored", ["isIgnored"]),

  callSessions: defineTable({
    provider: v.union(v.literal("whatsapp"), v.literal("instagram")),
    callId: v.string(),
    threadId: v.id("threads"),
    threadJid: v.string(),
    threadKind: v.optional(v.union(v.literal("direct"), v.literal("group"), v.literal("broadcast_or_system"))),
    fromJid: v.optional(v.string()),
    initiatorJid: v.optional(v.string()),
    isGroup: v.optional(v.boolean()),
    isVideo: v.optional(v.boolean()),
    offeredAt: v.optional(v.number()),
    ringingAt: v.optional(v.number()),
    acceptedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    lastStatus: v.union(
      v.literal("offer"),
      v.literal("ringing"),
      v.literal("timeout"),
      v.literal("reject"),
      v.literal("accept"),
      v.literal("terminate"),
    ),
    sawSelfEvent: v.boolean(),
    sawPeerEvent: v.boolean(),
    qualifiesForReplyBarrier: v.boolean(),
    replyBarrierAppliedAt: v.optional(v.number()),
    offline: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_provider_and_callId", ["provider", "callId"])
    .index("by_threadId_and_updatedAt", ["threadId", "updatedAt"])
    .index("by_threadId_and_endedAt", ["threadId", "endedAt"]),

  messages: defineTable({
    provider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"))),
    threadId: v.id("threads"),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    origin: v.optional(v.union(v.literal("live"), v.literal("history_sync"), v.literal("history_fetch"))),
    isStatus: v.optional(v.boolean()),
    providerMessageId: v.optional(v.string()),
    whatsappMessageId: v.optional(v.string()),
    toolRunId: v.optional(v.string()),
    senderJid: v.string(),
    text: v.string(),
    messageType: v.optional(
      v.union(
        v.literal("text"),
        v.literal("reaction"),
        v.literal("sticker"),
        v.literal("meme"),
        v.literal("image"),
        v.literal("video"),
        v.literal("audio"),
        v.literal("voice_note"),
        v.literal("document"),
      ),
    ),
    reactionEmoji: v.optional(v.string()),
    reactionTargetWhatsAppMessageId: v.optional(v.string()),
    mediaAssetId: v.optional(v.id("mediaAssets")),
    mediaCaption: v.optional(v.string()),
    messageAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_thread_messageAt", ["threadId", "messageAt"])
    .index("by_thread_providerMessageId", ["threadId", "providerMessageId"])
    .index("by_thread_whatsappMessageId", ["threadId", "whatsappMessageId"])
    .index("by_provider_and_providerMessageId", ["provider", "providerMessageId"])
    .index("by_isStatus_and_messageAt", ["isStatus", "messageAt"])
    .index("by_mediaAssetId", ["mediaAssetId"])
    .index("by_provider_and_createdAt", ["provider", "createdAt"])
    .index("by_createdAt", ["createdAt"])
    .index("by_messageType_and_createdAt", ["messageType", "createdAt"])
    .searchIndex("search_text", {
      searchField: "text",
      filterFields: ["threadId", "direction", "origin"],
    }),

  messageEmbeddings: defineTable({
    threadId: v.id("threads"),
    messageId: v.id("messages"),
    modelVersion: v.string(),
    contentHash: v.string(),
    vector: v.array(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_message_and_modelVersion", ["messageId", "modelVersion"])
    .index("by_thread_and_updatedAt", ["threadId", "updatedAt"])
    .index("by_thread_and_modelVersion_and_updatedAt", ["threadId", "modelVersion", "updatedAt"]),

  conversationSignals: defineTable({
    threadId: v.id("threads"),
    messageId: v.id("messages"),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    signalType: v.union(
      v.literal("checkin_prompt"),
      v.literal("checkin_response"),
      v.literal("topic_start"),
      v.literal("topic_continue"),
      v.literal("topic_close"),
      v.literal("topic_pivot"),
    ),
    topicKey: v.optional(v.string()),
    confidence: v.number(),
    excerpt: v.optional(v.string()),
    messageAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_threadId_and_createdAt", ["threadId", "createdAt"])
    .index("by_threadId_and_signalType_and_createdAt", ["threadId", "signalType", "createdAt"])
    .index("by_threadId_and_topicKey_and_createdAt", ["threadId", "topicKey", "createdAt"])
    .index("by_threadId_and_messageAt", ["threadId", "messageAt"])
    .index("by_messageId", ["messageId"]),

  threadConversationState: defineTable({
    threadId: v.id("threads"),
    lastMutualCheckInAt: v.optional(v.number()),
    lastOutboundCheckInAt: v.optional(v.number()),
    lastInboundCheckInAt: v.optional(v.number()),
    currentPrimaryTopicKey: v.optional(v.string()),
    topicDyingScore: v.optional(v.number()),
    nextMove: v.union(v.literal("none"), v.literal("check_in"), v.literal("pivot"), v.literal("close")),
    conversationEndImminent: v.optional(v.boolean()),
    topicDwellScore: v.optional(v.number()),
    lastPivotAt: v.optional(v.number()),
    lastCloseAt: v.optional(v.number()),
    lastLeadQuestionAt: v.optional(v.number()),
    updatedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_threadId", ["threadId"])
    .index("by_nextMove_and_updatedAt", ["nextMove", "updatedAt"]),

  threadTopicLanes: defineTable({
    threadId: v.id("threads"),
    topicKey: v.string(),
    topicLabel: v.string(),
    status: v.union(v.literal("active"), v.literal("cooling"), v.literal("closed")),
    firstMessageAt: v.number(),
    lastMessageAt: v.number(),
    lastInboundAt: v.optional(v.number()),
    lastOutboundAt: v.optional(v.number()),
    inboundTurns: v.number(),
    outboundTurns: v.number(),
    ackStreak: v.number(),
    dyingScore: v.number(),
    updatedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_threadId_and_topicKey", ["threadId", "topicKey"])
    .index("by_threadId_and_status_and_lastMessageAt", ["threadId", "status", "lastMessageAt"]),

  threadMemory: defineTable({
    threadId: v.id("threads"),
    summary: v.string(),
    styleNotes: v.array(v.string()),
    updatedAt: v.number(),
  }).index("by_thread", ["threadId"]),

  contactMemoryFacts: defineTable({
    threadId: v.id("threads"),
    factKey: v.string(),
    factValue: v.string(),
    factType: v.union(
      v.literal("preference"),
      v.literal("profile"),
      v.literal("schedule"),
      v.literal("relationship"),
      v.literal("promise"),
      v.literal("other"),
    ),
    confidence: v.number(),
    sourceMessageId: v.optional(v.id("messages")),
    sourceMessageAt: v.optional(v.number()),
    sourceExcerpt: v.optional(v.string()),
    factStatus: v.optional(
      v.union(v.literal("active"), v.literal("superseded"), v.literal("expired"), v.literal("quarantined")),
    ),
    expiresAt: v.optional(v.number()),
    supersededAt: v.optional(v.number()),
    supersededByFactKey: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread_and_key", ["threadId", "factKey"])
    .index("by_thread_and_updatedAt", ["threadId", "updatedAt"])
    .index("by_thread_and_factStatus_and_updatedAt", ["threadId", "factStatus", "updatedAt"])
    .index("by_thread_and_type_and_updatedAt", ["threadId", "factType", "updatedAt"])
    .index("by_updatedAt", ["updatedAt"]),

  replyDrafts: defineTable({
    messageProvider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"))),
    threadId: v.id("threads"),
    sourceMessageId: v.id("messages"),
    toolRunId: v.optional(v.string()),
    text: v.string(),
    sendKind: v.optional(v.union(v.literal("text"), v.literal("reaction"), v.literal("sticker"), v.literal("meme"), v.literal("voice_note"))),
    isStatusPost: v.optional(v.boolean()),
    statusAudienceJids: v.optional(v.array(v.string())),
    statusTrendTheme: v.optional(v.string()),
    statusDemographicHint: v.optional(v.string()),
    statusFormat: v.optional(v.union(v.literal("text"), v.literal("meme"))),
    reactionEmoji: v.optional(v.string()),
    reactionTargetMessageId: v.optional(v.id("messages")),
    mediaAssetId: v.optional(v.id("mediaAssets")),
    mediaCaption: v.optional(v.string()),
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
    outreachMode: v.optional(outreachModeValidator),
    contextPack: v.optional(contextPackValidator),
    reason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_status", ["status"])
    .index("by_messageProvider_and_status", ["messageProvider", "status"])
    .index("by_sourceMessage", ["sourceMessageId"])
    .index("by_mediaAssetId", ["mediaAssetId"]),

  outbox: defineTable({
    messageProvider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"))),
    threadId: v.id("threads"),
    draftId: v.id("replyDrafts"),
    toolRunId: v.optional(v.string()),
    followUpId: v.optional(v.id("followUps")),
    messageText: v.string(),
    sendKind: v.optional(v.union(v.literal("text"), v.literal("reaction"), v.literal("sticker"), v.literal("meme"), v.literal("voice_note"))),
    isStatusPost: v.optional(v.boolean()),
    statusAudienceJids: v.optional(v.array(v.string())),
    statusTrendTheme: v.optional(v.string()),
    statusDemographicHint: v.optional(v.string()),
    statusFormat: v.optional(v.union(v.literal("text"), v.literal("meme"))),
    statusReviewRequired: v.optional(v.boolean()),
    reactionEmoji: v.optional(v.string()),
    reactionTargetProviderMessageId: v.optional(v.string()),
    replyTargetProviderMessageId: v.optional(v.string()),
    reactionTargetWhatsAppMessageId: v.optional(v.string()),
    preReactionEmoji: v.optional(v.string()),
    mediaAssetId: v.optional(v.id("mediaAssets")),
    mediaCaption: v.optional(v.string()),
    sendAt: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("claimed"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    workerId: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    leaseRecoveryCount: v.optional(v.number()),
    lastLeaseRecoveredAt: v.optional(v.number()),
    attempts: v.number(),
    idempotencyKey: v.string(),
    provider: v.union(v.literal("azure"), v.literal("codex"), v.literal("heuristic")),
    outreachMode: v.optional(outreachModeValidator),
    contextPack: v.optional(contextPackValidator),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status_sendAt", ["status", "sendAt"])
    .index("by_status_leaseExpiresAt", ["status", "leaseExpiresAt"])
    .index("by_messageProvider_and_status_sendAt", ["messageProvider", "status", "sendAt"])
    .index("by_messageProvider_and_status_leaseExpiresAt", ["messageProvider", "status", "leaseExpiresAt"])
    .index("by_thread_and_status", ["threadId", "status"])
    .index("by_worker", ["workerId"])
    .index("by_draft", ["draftId"])
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_mediaAssetId", ["mediaAssetId"]),

  inboundDedupeKeys: defineTable({
    provider: v.union(v.literal("whatsapp"), v.literal("instagram")),
    providerMessageId: v.string(),
    threadId: v.id("threads"),
    messageId: v.id("messages"),
    createdAt: v.number(),
  })
    .index("by_provider_and_providerMessageId", ["provider", "providerMessageId"])
    .index("by_threadId_and_createdAt", ["threadId", "createdAt"]),

  aiFeedbackSignals: defineTable({
    threadId: v.id("threads"),
    outboxId: v.optional(v.id("outbox")),
    toolRunId: v.optional(v.string()),
    path: aiFeedbackPathValidator,
    signalType: v.string(),
    score: v.number(),
    metadata: aiFeedbackMetadataValidator,
    createdAt: v.number(),
  })
    .index("by_threadId_and_createdAt", ["threadId", "createdAt"])
    .index("by_outboxId_and_createdAt", ["outboxId", "createdAt"])
    .index("by_toolRunId_and_createdAt", ["toolRunId", "createdAt"])
    .index("by_path_and_createdAt", ["path", "createdAt"])
    .index("by_signalType_and_createdAt", ["signalType", "createdAt"]),

  aiOutcomes: defineTable({
    threadId: v.id("threads"),
    outboxId: v.optional(v.id("outbox")),
    toolRunId: v.optional(v.string()),
    path: aiFeedbackPathValidator,
    windowStartAt: v.number(),
    windowEndAt: v.number(),
    signalCounts: aiOutcomeSignalCountsValidator,
    engagementScore: v.number(),
    frictionScore: v.number(),
    qualityScore: v.number(),
    label: aiOutcomeLabelValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_threadId_and_updatedAt", ["threadId", "updatedAt"])
    .index("by_outboxId_and_updatedAt", ["outboxId", "updatedAt"])
    .index("by_toolRunId_and_updatedAt", ["toolRunId", "updatedAt"])
    .index("by_path_and_updatedAt", ["path", "updatedAt"])
    .index("by_label_and_updatedAt", ["label", "updatedAt"]),

  aiCandidateEvals: defineTable({
    threadId: v.id("threads"),
    outboxId: v.optional(v.id("outbox")),
    toolRunId: v.optional(v.string()),
    path: aiFeedbackPathValidator,
    candidateId: v.string(),
    selected: v.boolean(),
    guardrailBlocked: v.boolean(),
    featureVector: aiCandidateFeatureVectorValidator,
    scoreBreakdown: aiCandidateScoreBreakdownValidator,
    provider: v.union(v.literal("azure"), v.literal("codex"), v.literal("heuristic")),
    model: v.string(),
    textHash: v.string(),
    createdAt: v.number(),
  })
    .index("by_threadId_and_createdAt", ["threadId", "createdAt"])
    .index("by_outboxId_and_createdAt", ["outboxId", "createdAt"])
    .index("by_toolRunId_and_createdAt", ["toolRunId", "createdAt"])
    .index("by_path_and_createdAt", ["path", "createdAt"]),

  aiTuningProfiles: defineTable({
    path: aiFeedbackPathValidator,
    version: v.number(),
    sampleSize: v.number(),
    trainingWindowDays: v.number(),
    retrievalWeights: aiTuningRetrievalWeightsValidator,
    rerankWeights: aiTuningRerankWeightsValidator,
    thresholds: aiTuningThresholdsValidator,
    boundsProfile: aiTuningBoundsProfileValidator,
    anomalyFreezeActive: v.boolean(),
    anomalyReason: v.optional(v.string()),
    learnedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_path_and_learnedAt", ["path", "learnedAt"])
    .index("by_path_and_createdAt", ["path", "createdAt"])
    .index("by_createdAt", ["createdAt"]),

  aiBackfillJobs: defineTable({
    jobKey: v.string(),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
    cursor: v.optional(v.union(v.string(), v.null())),
    processedCount: v.number(),
    error: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_jobKey", ["jobKey"]),

  followUps: defineTable({
    threadId: v.id("threads"),
    sourceMessageId: v.id("messages"),
    reason: v.string(),
    draftText: v.string(),
    dueAt: v.number(),
    kind: v.optional(v.union(v.literal("promise"), v.literal("request"), v.literal("plan"))),
    direction: v.optional(v.union(v.literal("inbound"), v.literal("outbound"))),
    confidence: v.optional(v.number()),
    normalizedKey: v.optional(v.string()),
    sourceSnippet: v.optional(v.string()),
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

  styleProfileHistory: defineTable({
    scope: v.union(v.literal("global"), v.literal("thread")),
    threadId: v.optional(v.id("threads")),
    mimicryLevel: v.number(),
    commonPhrases: v.array(v.string()),
    punctuationStyle: v.array(v.string()),
    humorNotes: v.array(v.string()),
    spellingNotes: v.array(v.string()),
    reason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_scope_and_createdAt", ["scope", "createdAt"])
    .index("by_createdAt", ["createdAt"]),

  personalityProfiles: defineTable({
    slug: v.string(),
    name: v.string(),
    description: v.string(),
    prompt: v.string(),
    defaultIntensity: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_updatedAt", ["updatedAt"]),

  personalityProfileVersions: defineTable({
    profileSlug: v.string(),
    versionNumber: v.number(),
    name: v.string(),
    description: v.string(),
    prompt: v.string(),
    defaultIntensity: v.number(),
    reason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_profileSlug_and_versionNumber", ["profileSlug", "versionNumber"])
    .index("by_profileSlug_and_createdAt", ["profileSlug", "createdAt"]),

  threadPersonalitySettings: defineTable({
    threadId: v.id("threads"),
    profileSlug: v.string(),
    intensity: v.number(),
    customPrompt: v.optional(v.string()),
    memePolicyMode: v.optional(v.union(v.literal("auto"), v.literal("always_allow"), v.literal("always_block"))),
    threadPromptProfile: v.optional(v.string()),
    threadPromptProfileSource: v.optional(v.union(v.literal("manual"), v.literal("auto"))),
    threadPromptProfileLookbackDays: v.optional(v.number()),
    threadPromptProfileMessageCount: v.optional(v.number()),
    threadPromptProfileUpdatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_profileSlug", ["profileSlug"]),

  relationshipThreadState: defineTable({
    threadId: v.id("threads"),
    profileSlug: v.optional(v.string()),
    priorityTier: v.union(v.literal("romantic"), v.literal("professional"), v.literal("general")),
    trustScore: v.number(),
    warmthTrend: v.union(v.literal(-1), v.literal(0), v.literal(1)),
    conflictFlag: v.boolean(),
    responsivenessMismatch: v.boolean(),
    repairNeeded: v.boolean(),
    lastReason: v.optional(v.string()),
    lastInboundAt: v.optional(v.number()),
    updatedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_priorityTier_and_updatedAt", ["priorityTier", "updatedAt"])
    .index("by_updatedAt", ["updatedAt"]),

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
    resolvedAt: v.optional(v.number()),
    resolutionNote: v.optional(v.string()),
    resolvedBy: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_resolvedAt_and_createdAt", ["resolvedAt", "createdAt"]),

  providerRuns: defineTable({
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
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_provider_and_createdAt", ["provider", "createdAt"]),

  toolRuns: defineTable({
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
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_threadId_and_createdAt", ["threadId", "createdAt"])
    .index("by_threadId_and_toolRunId", ["threadId", "toolRunId"])
    .index("by_toolName_and_createdAt", ["toolName", "createdAt"])
    .index("by_status_and_createdAt", ["status", "createdAt"]),

  systemEvents: defineTable({
    source: v.union(
      v.literal("worker"),
      v.literal("convex"),
      v.literal("dashboard"),
      v.literal("ai"),
    ),
    eventType: v.string(),
    threadId: v.optional(v.id("threads")),
    toolRunId: v.optional(v.string()),
    outboxId: v.optional(v.id("outbox")),
    detail: v.string(),
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_type", ["eventType"])
    .index("by_threadId_and_createdAt", ["threadId", "createdAt"])
    .index("by_threadId_and_eventType_and_createdAt", ["threadId", "eventType", "createdAt"])
    .index("by_threadId_and_toolRunId", ["threadId", "toolRunId"]),

  setupRuntime: defineTable({
    key: v.string(),
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
    listenerActive: v.optional(v.boolean()),
    listenerWorkerId: v.optional(v.string()),
    listenerMessage: v.optional(v.string()),
    listenerLastSeenAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_provider", ["provider"]),

  messageReactions: defineTable({
    provider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"))),
    threadId: v.id("threads"),
    messageId: v.id("messages"),
    actorJid: v.string(),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    emoji: v.string(),
    providerMessageId: v.optional(v.string()),
    whatsappMessageId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_messageId_and_actorJid", ["messageId", "actorJid"])
    .index("by_threadId_and_messageId", ["threadId", "messageId"])
    .index("by_threadId", ["threadId"]),

  mediaAssets: defineTable({
    kind: v.union(
      v.literal("sticker"),
      v.literal("meme"),
      v.literal("image"),
      v.literal("video"),
      v.literal("audio"),
      v.literal("document"),
    ),
    label: v.string(),
    tags: v.array(v.string()),
    enabled: v.boolean(),
    source: v.optional(v.union(v.literal("uploaded"), v.literal("generated"), v.literal("captured"))),
    threadId: v.optional(v.id("threads")),
    fileId: v.id("_storage"),
    mimeType: v.string(),
    contentHash: v.optional(v.string()),
    providerContentHash: v.optional(v.string()),
    generationPromptHash: v.optional(v.string()),
    generationContextSnippet: v.optional(v.string()),
    lastUsedAt: v.optional(v.number()),
    contextSummary: v.optional(v.string()),
    contextTags: v.optional(v.array(v.string())),
    contextTriggers: v.optional(v.array(v.string())),
    contextAvoid: v.optional(v.array(v.string())),
    contextConfidence: v.optional(v.number()),
    contextSource: v.optional(v.union(v.literal("vision_ai"), v.literal("heuristic"))),
    contextUpdatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_kind_and_enabled", ["kind", "enabled"])
    .index("by_kind", ["kind"])
    .index("by_kind_and_contentHash", ["kind", "contentHash"])
    .index("by_kind_and_providerContentHash", ["kind", "providerContentHash"])
    .index("by_kind_and_source_and_threadId_and_enabled", ["kind", "source", "threadId", "enabled"]),

  threadGrounding: defineTable({
    threadId: v.id("threads"),
    myName: v.optional(v.string()),
    theirName: v.optional(v.string()),
    autoAliases: v.array(v.string()),
    vibeNotes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_threadId", ["threadId"]),

  backlogThreadState: defineTable({
    threadId: v.id("threads"),
    importanceOverride: v.optional(
      v.union(v.literal("critical"), v.literal("high"), v.literal("medium"), v.literal("low")),
    ),
    relationshipOverride: v.optional(
      v.union(
        v.literal("girlfriend"),
        v.literal("relationship"),
        v.literal("friendship"),
        v.literal("casual"),
        v.literal("family"),
        v.literal("business"),
      ),
    ),
    snoozedUntil: v.optional(v.number()),
    snoozeReason: v.optional(v.string()),
    unresolvedCount: v.number(),
    pendingSince: v.optional(v.number()),
    latestUnresolvedAt: v.optional(v.number()),
    latestUnresolvedMessageId: v.optional(v.id("messages")),
    latestUnresolvedText: v.optional(v.string()),
    lastInboundAt: v.optional(v.number()),
    lastOutboundAt: v.optional(v.number()),
    relationship: v.union(
      v.literal("girlfriend"),
      v.literal("relationship"),
      v.literal("friendship"),
      v.literal("casual"),
      v.literal("family"),
      v.literal("business"),
    ),
    importance: v.union(v.literal("critical"), v.literal("high"), v.literal("medium"), v.literal("low")),
    recommendation: v.union(
      v.literal("answer"),
      v.literal("answer_with_ack"),
      v.literal("restart"),
      v.literal("already_queued"),
    ),
    score: v.number(),
    lastActionAt: v.optional(v.number()),
    lastActionType: v.optional(
      v.union(
        v.literal("answer_draft"),
        v.literal("restart_draft"),
        v.literal("ignored"),
        v.literal("snoozed"),
        v.literal("unsnoozed"),
      ),
    ),
    lastEvaluatedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_threadId", ["threadId"])
    .index("by_unresolvedCount_and_updatedAt", ["unresolvedCount", "updatedAt"])
    .index("by_importance_and_updatedAt", ["importance", "updatedAt"])
    .index("by_relationship_and_updatedAt", ["relationship", "updatedAt"])
    .index("by_snoozedUntil", ["snoozedUntil"])
    .index("by_updatedAt", ["updatedAt"]),

  romanceMorningState: defineTable({
    threadId: v.id("threads"),
    lastSentAt: v.optional(v.number()),
    lastMode: v.optional(v.union(v.literal("lead"), v.literal("warm"))),
    lastPromptFingerprint: v.optional(v.string()),
    lastInboundAfterSendAt: v.optional(v.number()),
    noReplyStreak: v.number(),
    updatedAt: v.number(),
  })
    .index("by_threadId", ["threadId"])
    .index("by_updatedAt", ["updatedAt"]),
});
