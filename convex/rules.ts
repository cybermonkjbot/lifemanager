import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { classifyThreadKind, directIgnoreContactKey, directIgnoreRuleCandidates } from "./lib/threadEligibility";
import { assertTenantOwned, resolveTenantForMutation, resolveTenantForQuery } from "./lib/tenantSecurity";
import { assertTenantBillingActive } from "./lib/billingAccess";

const IGNORE_CONTACT_FALLBACK_SCAN_LIMIT = 2000;
const providerValidator = v.union(v.literal("whatsapp"), v.literal("instagram"), v.literal("imessage"), v.literal("telegram"));
const tenantScopeArgs = {
  tenantId: v.optional(v.id("tenantAccounts")),
  connectorTokenHash: v.optional(v.string()),
};

function inferProviderFromTarget(targetValue: string) {
  const normalized = targetValue.trim().toLowerCase();
  if (normalized.startsWith("ig:") || normalized.startsWith("instagram:")) {
    return "instagram" as const;
  }
  if (normalized.startsWith("imessage:")) {
    return "imessage" as const;
  }
  if (normalized.startsWith("telegram:")) {
    return "telegram" as const;
  }
  return "whatsapp" as const;
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

export const list = query({
  args: {
    ...tenantScopeArgs,
    ignoreRuleLimit: v.optional(v.number()),
    configLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForQuery(ctx, args);
    const ignoreRuleLimit = Math.min(args.ignoreRuleLimit ?? 200, 500);
    const configLimit = Math.min(args.configLimit ?? 20, 50);
    const ignoreRules = tenantId
      ? await ctx.db
          .query("ignoreRules")
          .withIndex("by_tenantId_and_type", (q) => q.eq("tenantId", tenantId))
          .take(ignoreRuleLimit)
      : await ctx.db.query("ignoreRules").take(ignoreRuleLimit);
    const appConfig = tenantId
      ? await ctx.db
          .query("appConfig")
          .withIndex("by_tenantId_and_key", (q) => q.eq("tenantId", tenantId))
          .take(configLimit)
      : await ctx.db.query("appConfig").take(configLimit);
    return {
      ignoreRules,
      appConfig,
    };
  },
});

export const upsertIgnoreRule = mutation({
  args: {
    ...tenantScopeArgs,
    targetType: v.optional(v.union(v.literal("contact"), v.literal("group"), v.literal("keyword"))),
    threadId: v.optional(v.id("threads")),
    targetValue: v.optional(v.string()),
    provider: v.optional(providerValidator),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForOptionalMutation(ctx, args);
    let targetType = args.targetType;
    let targetValue = args.targetValue?.trim() || "";
    let provider = args.provider || inferProviderFromTarget(targetValue);

    if (args.threadId) {
      const thread = await ctx.db.get(args.threadId);
      if (!thread) {
        throw new Error("Thread not found.");
      }
      assertTenantOwned(tenantId, thread.tenantId);
      provider = thread.provider || provider;
      const threadKind = thread.threadKind || classifyThreadKind({ jid: thread.jid, isGroupHint: thread.isGroup, provider });
      targetType = threadKind === "group" ? "group" : "contact";
      if (!targetValue) {
        targetValue = thread.jid;
      }
    } else if (!targetType) {
      const inferredThreadKind = classifyThreadKind({ jid: targetValue, provider });
      targetType = inferredThreadKind === "group" ? "group" : "contact";
    }

    if (!targetType) {
      throw new Error("targetType is required.");
    }
    if (!targetValue) {
      throw new Error("targetValue is required.");
    }

    const now = Date.now();
    const targets =
      targetType === "contact"
        ? directIgnoreRuleCandidates({ jid: targetValue, provider })
        : [targetValue];

    let firstRuleId: string | null = null;
    for (const value of new Set(targets)) {
      const existing = tenantId
        ? await ctx.db
            .query("ignoreRules")
            .withIndex("by_tenantId_and_target", (q) =>
              q.eq("tenantId", tenantId).eq("targetType", targetType).eq("targetValue", value),
            )
            .first()
        : await ctx.db
            .query("ignoreRules")
            .withIndex("by_target", (q) => q.eq("targetType", targetType).eq("targetValue", value))
            .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          enabled: args.enabled,
          updatedAt: now,
        });
        firstRuleId = firstRuleId || existing._id;
      } else {
        const inserted = await ctx.db.insert("ignoreRules", {
          tenantId,
          targetType,
          targetValue: value,
          enabled: args.enabled,
          createdAt: now,
          updatedAt: now,
        });
        firstRuleId = firstRuleId || inserted;
      }
    }

    if (targetType === "contact") {
      const lookupKey = directIgnoreContactKey({ jid: targetValue, provider });
      if (lookupKey) {
        const directThreads = tenantId
          ? await ctx.db
              .query("threads")
              .withIndex("by_tenantId_and_jid", (q) => q.eq("tenantId", tenantId))
              .take(IGNORE_CONTACT_FALLBACK_SCAN_LIMIT)
          : await ctx.db
              .query("threads")
              .withIndex("by_threadKind_and_lastMessageAt", (q) => q.eq("threadKind", "direct"))
              .take(IGNORE_CONTACT_FALLBACK_SCAN_LIMIT);
        for (const thread of directThreads) {
          if ((thread.provider || "whatsapp") !== provider) {
            continue;
          }
          const threadLookupKey = directIgnoreContactKey({ jid: thread.jid, provider });
          if (!threadLookupKey || threadLookupKey !== lookupKey) {
            continue;
          }
          await ctx.db.patch(thread._id, {
            isIgnored: args.enabled,
            updatedAt: now,
          });
        }
      }
    }

    return firstRuleId;
  },
});

export const setIgnoreRuleEnabled = mutation({
  args: {
    ...tenantScopeArgs,
    ruleId: v.id("ignoreRules"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForOptionalMutation(ctx, args);
    const row = await ctx.db.get(args.ruleId);
    if (!row) {
      throw new Error("Rule not found.");
    }
    assertTenantOwned(tenantId, row.tenantId);
    await ctx.db.patch(row._id, {
      enabled: args.enabled,
      updatedAt: Date.now(),
    });
    return row._id;
  },
});

export const deleteIgnoreRule = mutation({
  args: {
    ...tenantScopeArgs,
    ruleId: v.id("ignoreRules"),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForOptionalMutation(ctx, args);
    const row = await ctx.db.get(args.ruleId);
    if (!row) {
      return null;
    }
    assertTenantOwned(tenantId, row.tenantId);
    await ctx.db.delete(row._id);
    return row._id;
  },
});
