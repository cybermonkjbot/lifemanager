import { cronJobs, makeFunctionReference } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
const refRomanceMorningRun = makeFunctionReference<"mutation">("romanceProtocol:run");

crons.interval("process-confirmed-followups", { minutes: 1 }, internal.followupsPromoter.run, {});
crons.interval("recover-stuck-outbox-claims", { minutes: 2 }, internal.outbox.recoverExpiredClaims, {});
crons.interval("proactive-outreach", { minutes: 30 }, internal.outreach.run, {});
crons.interval("adaptive-romantic-morning", { minutes: 20 }, refRomanceMorningRun, {});
crons.interval("auto-status-builder", { minutes: 20 }, internal.statusBuilder.run, {});
crons.interval("refresh-backlog-snapshots", { minutes: 30 }, internal.backlog.refreshRecentInternal, {
  limit: 320,
});
crons.interval("nightly-memory-summary", { hours: 24 }, internal.memoryBatch.run, {});
crons.interval("retention-cleanup", { hours: 24 }, internal.retention.run, {});
crons.interval("ai-smartness-v2-backfill", { hours: 6 }, internal.aiFeedback.backfillOutcomes30d, {
  batchSize: 80,
});
crons.interval("ai-smartness-v2-train", { hours: 24 }, internal.aiFeedback.trainTuningProfiles, {
  trainingWindowDays: 30,
});

export default crons;
