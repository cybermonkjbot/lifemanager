import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

function readAdminSecret() {
  return process.env.ODOGWU_CONVEX_ADMIN_SECRET || process.env.ODOGWU_ADMIN_SECRET || process.env.SLM_ADMIN_SECRET || "";
}

function requireAdmin(adminSecret: string) {
  const expected = readAdminSecret();
  if (!expected || adminSecret !== expected) {
    throw new Error("Unauthorized.");
  }
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function requireValidEmail(email: string) {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Valid email is required.");
  }
  return normalized;
}

export const hasAny = query({
  args: {
    adminSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const rows = await ctx.db.query("adminUsers").take(1);
    return rows.length > 0;
  },
});

export const list = query({
  args: {
    adminSecret: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const limit = Math.min(Math.max(Math.round(args.limit || 100), 1), 200);
    const rows = await ctx.db.query("adminUsers").order("desc").take(limit);
    return rows.map((row) => ({
      email: row.email,
      emailNormalized: row.emailNormalized,
      canMasqueradeTenants: row.canMasqueradeTenants === true,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy,
    }));
  },
});

export const getCredential = query({
  args: {
    adminSecret: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const emailNormalized = requireValidEmail(args.email);
    const row = await ctx.db
      .query("adminUsers")
      .withIndex("by_emailNormalized", (q) => q.eq("emailNormalized", emailNormalized))
      .unique();
    if (!row) {
      return null;
    }
    return {
      email: row.email,
      emailNormalized: row.emailNormalized,
      pinSalt: row.pinSalt,
      pinHash: row.pinHash,
      canMasqueradeTenants: row.canMasqueradeTenants === true,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy,
    };
  },
});

export const upsert = mutation({
  args: {
    adminSecret: v.string(),
    email: v.string(),
    pinSalt: v.string(),
    pinHash: v.string(),
    canMasqueradeTenants: v.optional(v.boolean()),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const emailNormalized = requireValidEmail(args.email);
    const now = Date.now();
    const existing = await ctx.db
      .query("adminUsers")
      .withIndex("by_emailNormalized", (q) => q.eq("emailNormalized", emailNormalized))
      .unique();
    const next = {
      emailNormalized,
      email: args.email.trim(),
      pinSalt: args.pinSalt,
      pinHash: args.pinHash,
      canMasqueradeTenants: args.canMasqueradeTenants === true,
      updatedAt: now,
      createdBy: args.createdBy.trim().slice(0, 320) || undefined,
    };
    if (existing) {
      await ctx.db.patch(existing._id, next);
      return {
        email: next.email,
        emailNormalized,
        canMasqueradeTenants: next.canMasqueradeTenants,
        createdAt: existing.createdAt,
        updatedAt: now,
        createdBy: next.createdBy,
      };
    }
    await ctx.db.insert("adminUsers", {
      ...next,
      createdAt: now,
    });
    return {
      email: next.email,
      emailNormalized,
      canMasqueradeTenants: next.canMasqueradeTenants,
      createdAt: now,
      updatedAt: now,
      createdBy: next.createdBy,
    };
  },
});

export const remove = mutation({
  args: {
    adminSecret: v.string(),
    email: v.string(),
    currentAdminEmail: v.string(),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const emailNormalized = requireValidEmail(args.email);
    const currentEmailNormalized = requireValidEmail(args.currentAdminEmail);
    if (emailNormalized === currentEmailNormalized) {
      throw new Error("You cannot remove your own admin login.");
    }
    const existing = await ctx.db
      .query("adminUsers")
      .withIndex("by_emailNormalized", (q) => q.eq("emailNormalized", emailNormalized))
      .unique();
    if (!existing) {
      throw new Error("Admin user was not found.");
    }
    const remaining = await ctx.db.query("adminUsers").take(2);
    if (remaining.length <= 1) {
      throw new Error("At least one configured admin is required.");
    }
    await ctx.db.delete(existing._id);
    return true;
  },
});

export const getCapabilities = query({
  args: {
    adminSecret: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const emailNormalized = requireValidEmail(args.email);
    const row = await ctx.db
      .query("adminUsers")
      .withIndex("by_emailNormalized", (q) => q.eq("emailNormalized", emailNormalized))
      .unique();
    if (!row) {
      return null;
    }
    return {
      email: row.email,
      emailNormalized: row.emailNormalized,
      canMasqueradeTenants: row.canMasqueradeTenants === true,
    };
  },
});
