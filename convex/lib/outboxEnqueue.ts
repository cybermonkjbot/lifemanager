import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export type OutboxSendKind = "text" | "reaction" | "sticker" | "meme" | "voice_note";

export type EnqueueOutboxArgs = {
  messageProvider: "whatsapp" | "instagram";
  threadId: Id<"threads">;
  draftId: Id<"replyDrafts">;
  toolRunId?: string;
  followUpId?: Id<"followUps">;
  messageText: string;
  sendKind?: OutboxSendKind;
  isStatusPost?: boolean;
  statusAudienceJids?: string[];
  statusTrendTheme?: string;
  statusDemographicHint?: string;
  statusFormat?: "text" | "meme";
  statusReviewRequired?: boolean;
  reactionEmoji?: string;
  reactionTargetProviderMessageId?: string;
  replyTargetProviderMessageId?: string;
  reactionTargetWhatsAppMessageId?: string;
  preReactionEmoji?: string;
  mediaAssetId?: Id<"mediaAssets">;
  mediaCaption?: string;
  sendAt: number;
  idempotencyKey: string;
  provider: "azure" | "codex" | "heuristic";
  outreachMode?: "proactive" | "good_morning" | "compliment";
  contextPack?: Doc<"outbox">["contextPack"];
  now?: number;
};

export async function enqueueOutbox(ctx: MutationCtx, args: EnqueueOutboxArgs) {
  const now = args.now ?? Date.now();
  const thread = await ctx.db.get(args.threadId);
  const tenantId = thread?.tenantId;

  const existing = await ctx.db
    .query("outbox")
    .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", args.idempotencyKey))
    .order("desc")
    .first();

  if (existing) {
    if (existing.status === "sent") {
      return { outboxId: existing._id, deduped: true, created: false };
    }

    await ctx.db.patch(existing._id, {
      tenantId: existing.tenantId || tenantId,
      messageProvider: args.messageProvider,
      threadId: args.threadId,
      draftId: args.draftId,
      toolRunId: args.toolRunId,
      followUpId: args.followUpId,
      messageText: args.messageText,
      sendKind: args.sendKind,
      isStatusPost: args.isStatusPost,
      statusAudienceJids: args.statusAudienceJids,
      statusTrendTheme: args.statusTrendTheme,
      statusDemographicHint: args.statusDemographicHint,
      statusFormat: args.statusFormat,
      statusReviewRequired: args.statusReviewRequired,
      reactionEmoji: args.reactionEmoji,
      reactionTargetProviderMessageId: args.reactionTargetProviderMessageId,
      replyTargetProviderMessageId: args.replyTargetProviderMessageId,
      reactionTargetWhatsAppMessageId: args.reactionTargetWhatsAppMessageId,
      preReactionEmoji: args.preReactionEmoji,
      mediaAssetId: args.mediaAssetId,
      mediaCaption: args.mediaCaption,
      sendAt: Math.max(now, Math.round(args.sendAt)),
      status: "pending",
      workerId: undefined,
      leaseExpiresAt: undefined,
      error: undefined,
      provider: args.provider,
      outreachMode: args.outreachMode,
      contextPack: args.contextPack,
      updatedAt: now,
    });

    return { outboxId: existing._id, deduped: true, created: false };
  }

  const outboxId = await ctx.db.insert("outbox", {
    tenantId,
    messageProvider: args.messageProvider,
    threadId: args.threadId,
    draftId: args.draftId,
    toolRunId: args.toolRunId,
    followUpId: args.followUpId,
    messageText: args.messageText,
    sendKind: args.sendKind,
    isStatusPost: args.isStatusPost,
    statusAudienceJids: args.statusAudienceJids,
    statusTrendTheme: args.statusTrendTheme,
    statusDemographicHint: args.statusDemographicHint,
    statusFormat: args.statusFormat,
    statusReviewRequired: args.statusReviewRequired,
    reactionEmoji: args.reactionEmoji,
    reactionTargetProviderMessageId: args.reactionTargetProviderMessageId,
    replyTargetProviderMessageId: args.replyTargetProviderMessageId,
    reactionTargetWhatsAppMessageId: args.reactionTargetWhatsAppMessageId,
    preReactionEmoji: args.preReactionEmoji,
    mediaAssetId: args.mediaAssetId,
    mediaCaption: args.mediaCaption,
    sendAt: Math.max(now, Math.round(args.sendAt)),
    status: "pending",
    attempts: 0,
    idempotencyKey: args.idempotencyKey,
    provider: args.provider,
    outreachMode: args.outreachMode,
    contextPack: args.contextPack,
    createdAt: now,
    updatedAt: now,
  });

  return { outboxId, deduped: false, created: true };
}
