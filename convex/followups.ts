import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 100);
    const items = await ctx.db
      .query("followUps")
      .withIndex("by_status_dueAt")
      .order("asc")
      .take(limit);

    return await Promise.all(
      items.map(async (item) => {
        const thread = await ctx.db.get(item.threadId);
        return {
          ...item,
          thread,
        };
      }),
    );
  },
});

export const confirm = mutation({
  args: {
    followUpId: v.id("followUps"),
  },
  handler: async (ctx, args) => {
    const followUp = await ctx.db.get(args.followUpId);
    if (!followUp) {
      throw new Error("Follow-up not found");
    }

    await ctx.db.patch(followUp._id, {
      status: "confirmed",
      updatedAt: Date.now(),
    });

    return followUp._id;
  },
});
