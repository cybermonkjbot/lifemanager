import { makeFunctionReference } from "convex/server";

export const convexRefs = {
  queueList: makeFunctionReference<"query">("queue:list"),
  threadsList: makeFunctionReference<"query">("threads:list"),
  threadGet: makeFunctionReference<"query">("threads:get"),
  followupsList: makeFunctionReference<"query">("followups:list"),
  todosList: makeFunctionReference<"query">("todos:list"),
  rulesList: makeFunctionReference<"query">("rules:list"),
  settingsGet: makeFunctionReference<"query">("settings:get"),
  systemHealth: makeFunctionReference<"query">("system:health"),
  systemSetupStatus: makeFunctionReference<"query">("system:setupStatus"),

  inboundIngest: makeFunctionReference<"mutation">("inbound:ingest"),
  draftSaveGenerated: makeFunctionReference<"mutation">("draft:saveGenerated"),
  draftCreateGuardrailHold: makeFunctionReference<"mutation">("draft:createGuardrailHold"),
  draftApprove: makeFunctionReference<"mutation">("draft:approve"),
  draftSnooze: makeFunctionReference<"mutation">("draft:snooze"),
  followupsConfirm: makeFunctionReference<"mutation">("followups:confirm"),
  todosFromCandidate: makeFunctionReference<"mutation">("todos:fromCandidate"),
  rulesUpsertIgnoreRule: makeFunctionReference<"mutation">("rules:upsertIgnoreRule"),

  outboxClaimDue: makeFunctionReference<"mutation">("outbox:claimDue"),
  outboxMarkTyping: makeFunctionReference<"mutation">("outbox:markTyping"),
  outboxHydrateAiOutreach: makeFunctionReference<"mutation">("outbox:hydrateAiOutreach"),
  outboxMarkSent: makeFunctionReference<"mutation">("outbox:markSent"),
  outboxMarkFailed: makeFunctionReference<"mutation">("outbox:markFailed"),

  systemPauseAutonomy: makeFunctionReference<"mutation">("system:pauseAutonomy"),
  systemResumeAutonomy: makeFunctionReference<"mutation">("system:resumeAutonomy"),
  systemRecordEvent: makeFunctionReference<"mutation">("system:recordEvent"),
  systemRecordProviderRun: makeFunctionReference<"mutation">("system:recordProviderRun"),
  systemUpsertSetupStatus: makeFunctionReference<"mutation">("system:upsertSetupStatus"),
  systemReportSetupListener: makeFunctionReference<"mutation">("system:reportSetupListener"),

  styleGetProfile: makeFunctionReference<"query">("style:getProfile"),
  styleSetMimicry: makeFunctionReference<"mutation">("style:setMimicry"),
  personalityListProfiles: makeFunctionReference<"query">("personality:listProfiles"),
  personalityGetThreadSetting: makeFunctionReference<"query">("personality:getThreadSetting"),
  personalitySetThreadSetting: makeFunctionReference<"mutation">("personality:setThreadSetting"),
  personalityUpsertProfile: makeFunctionReference<"mutation">("personality:upsertProfile"),

  mediaGenerateUploadUrl: makeFunctionReference<"mutation">("media:generateUploadUrl"),
  mediaRegisterAsset: makeFunctionReference<"mutation">("media:registerAsset"),
  mediaListAssets: makeFunctionReference<"query">("media:listAssets"),
  mediaGetEnabledByKind: makeFunctionReference<"query">("media:getEnabledByKind"),
  mediaGetAssetDownloadUrl: makeFunctionReference<"query">("media:getAssetDownloadUrl"),
  mediaToggleAsset: makeFunctionReference<"mutation">("media:toggleAsset"),
  mediaDeleteAsset: makeFunctionReference<"mutation">("media:deleteAsset"),

  groundingGetThreadGrounding: makeFunctionReference<"query">("grounding:getThreadGrounding"),
  groundingSaveThreadGrounding: makeFunctionReference<"mutation">("grounding:saveThreadGrounding"),
};

export type ConvexRefs = typeof convexRefs;
