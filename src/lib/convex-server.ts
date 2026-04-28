import { ConvexHttpClient } from "convex/browser";
import { convexRefs } from "./convex-refs";
import { readLocalInstanceConfig } from "./instance-config";

export function getConvexUrl(overrideUrl?: string) {
  return overrideUrl || process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "";
}

export function createConvexClient(overrideUrl?: string) {
  const url = getConvexUrl(overrideUrl);
  if (!url) {
    throw new Error("Missing CONVEX_URL or NEXT_PUBLIC_CONVEX_URL");
  }
  return new ConvexHttpClient(url);
}

async function getTenantScopeArgs() {
  const config = await readLocalInstanceConfig();
  const tenantId = config?.preferences.serviceMode === "hosted" ? config.account?.tenantId || "" : "";
  return tenantId ? { tenantId } : {};
}

export async function queryQueue() {
  const client = createConvexClient();
  return await client.query(convexRefs.queueList, await getTenantScopeArgs());
}

export async function queryThreads() {
  const client = createConvexClient();
  return await client.query(convexRefs.threadsList, { ...(await getTenantScopeArgs()), limit: 50 });
}

export async function queryThread(threadId: string) {
  const client = createConvexClient();
  return await client.query(convexRefs.threadGet, { ...(await getTenantScopeArgs()), threadId });
}

export async function queryFollowups() {
  const client = createConvexClient();
  return await client.query(convexRefs.followupsList, { ...(await getTenantScopeArgs()), limit: 80 });
}

export async function queryTodos() {
  const client = createConvexClient();
  return await client.query(convexRefs.todosList, await getTenantScopeArgs());
}

export async function queryRules() {
  const client = createConvexClient();
  return await client.query(convexRefs.rulesList, await getTenantScopeArgs());
}

export async function queryStyleProfile() {
  const client = createConvexClient();
  return await client.query(convexRefs.styleGetProfile, await getTenantScopeArgs());
}

export async function querySystemHealth() {
  const client = createConvexClient();
  return await client.query(convexRefs.systemHealth, await getTenantScopeArgs());
}

export async function approveDraft(draftId: string, options?: { sendImmediately?: boolean }) {
  const client = createConvexClient();
  return await client.mutation(convexRefs.draftApprove, {
    draftId,
    sendImmediately: options?.sendImmediately,
  });
}

export async function snoozeDraft(draftId: string, minutes: number) {
  const client = createConvexClient();
  return await client.mutation(convexRefs.draftSnooze, { draftId, minutes });
}

export async function confirmFollowup(followUpId: string) {
  const client = createConvexClient();
  return await client.mutation(convexRefs.followupsConfirm, { followUpId });
}

export async function createTodoFromCandidate(candidateId: string) {
  const client = createConvexClient();
  return await client.mutation(convexRefs.todosFromCandidate, { candidateId });
}

type IgnoreTargetType = "contact" | "group" | "keyword";

export async function upsertIgnoreTarget(targetValue: string, enabled: boolean, targetType?: IgnoreTargetType) {
  const client = createConvexClient();
  const payload: {
    tenantId?: string;
    targetValue: string;
    enabled: boolean;
    targetType?: IgnoreTargetType;
  } = {
    ...(await getTenantScopeArgs()),
    targetValue,
    enabled,
  };
  if (targetType) {
    payload.targetType = targetType;
  }
  return await client.mutation(convexRefs.rulesUpsertIgnoreRule, payload);
}

export async function upsertIgnoreContact(targetValue: string, enabled: boolean) {
  return await upsertIgnoreTarget(targetValue, enabled, "contact");
}

export async function pauseAutonomy() {
  const client = createConvexClient();
  return await client.mutation(convexRefs.systemPauseAutonomy, await getTenantScopeArgs());
}

export async function resumeAutonomy() {
  const client = createConvexClient();
  return await client.mutation(convexRefs.systemResumeAutonomy, await getTenantScopeArgs());
}

export async function setMimicry(mimicryLevel: number) {
  const client = createConvexClient();
  return await client.mutation(convexRefs.styleSetMimicry, { ...(await getTenantScopeArgs()), mimicryLevel });
}
