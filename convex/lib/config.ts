import type { MutationCtx, QueryCtx } from "./types";
import { DEFAULT_AUTONOMY_PAUSED, DEFAULT_IGNORE_GROUPS } from "./constants";

export type AppConfig = {
  autonomyPaused: boolean;
  ignoreGroupsByDefault: boolean;
};

export async function getConfig(ctx: QueryCtx | MutationCtx): Promise<AppConfig> {
  const rows = await ctx.db.query("appConfig").collect();
  const map = new Map(rows.map((row) => [row.key, row.value]));

  return {
    autonomyPaused: map.get("autonomyPaused")
      ? map.get("autonomyPaused") === "true"
      : DEFAULT_AUTONOMY_PAUSED,
    ignoreGroupsByDefault: map.get("ignoreGroupsByDefault")
      ? map.get("ignoreGroupsByDefault") === "true"
      : DEFAULT_IGNORE_GROUPS,
  };
}

export async function setConfigValue(ctx: MutationCtx, key: string, value: string) {
  const existing = await ctx.db
    .query("appConfig")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();

  const updatedAt = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, { value, updatedAt });
    return existing._id;
  }

  return await ctx.db.insert("appConfig", {
    key,
    value,
    updatedAt,
  });
}
