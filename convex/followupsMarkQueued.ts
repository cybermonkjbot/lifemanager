import { v } from "convex/values";
import { mutation } from "./_generated/server";

export const run = mutation({
  args: {
    followUpId: v.id("followUps"),
  },
  handler: async (ctx, args) => {
    const followup = await ctx.db.get(args.followUpId);
    if (!followup) {
      return null;
    }

    await ctx.db.patch(followup._id, {
      status: "queued",
      updatedAt: Date.now(),
    });

    return followup._id;
  },
});
