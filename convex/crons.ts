import { anyApi, cronJobs } from "convex/server";

const crons = cronJobs();

crons.interval("process-confirmed-followups", { minutes: 1 }, anyApi.followupsPromoter.run, {});
crons.interval("nightly-memory-summary", { hours: 24 }, anyApi.memoryBatch.run, {});
crons.interval("retention-cleanup", { hours: 24 }, anyApi.retention.run, {});

export default crons;
