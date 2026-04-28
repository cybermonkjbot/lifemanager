import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { consumeRateLimit } from "./lib/rateLimit";

function readServerSecret() {
  return (
    process.env.SLM_RATE_LIMIT_SECRET ||
    process.env.ODOGWU_CONVEX_ADMIN_SECRET ||
    process.env.ODOGWU_ADMIN_SECRET ||
    process.env.SLM_ADMIN_SECRET ||
    ""
  );
}

function requireServerSecret(value: string) {
  const expected = readServerSecret();
  if (!expected || value !== expected) {
    throw new Error("Unauthorized.");
  }
}

export const check = mutation({
  args: {
    serverSecret: v.string(),
    key: v.string(),
    scope: v.string(),
    limit: v.number(),
    windowMs: v.number(),
    penaltyMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret);
    return await consumeRateLimit(ctx, args);
  },
});
