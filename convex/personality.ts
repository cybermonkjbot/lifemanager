import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";

type DefaultPersonalityProfile = {
  slug: string;
  name: string;
  description: string;
  prompt: string;
  defaultIntensity: number;
};

type PersonalityProfileView = {
  slug: string;
  name: string;
  description: string;
  prompt: string;
  defaultIntensity: number;
  updatedAt: number;
  createdAt: number;
  isDefault: boolean;
};

const DEFAULT_PERSONALITY_PROFILES: DefaultPersonalityProfile[] = [
  {
    slug: "girlfriend",
    name: "Girlfriend / Boyfriend",
    description: "Affectionate, intimate, reassuring tone for a partner.",
    prompt:
      "Write with affectionate warmth, emotional attentiveness, and soft reassurance. Keep it caring, flirty when natural, and specific to the context.",
    defaultIntensity: 0.86,
  },
  {
    slug: "relationship",
    name: "Romantic Relationship",
    description: "Emotionally invested and thoughtful, less playful than full-flirty.",
    prompt:
      "Write with steady warmth and relationship-minded care. Be emotionally present, considerate, and clear about intentions without sounding dramatic.",
    defaultIntensity: 0.78,
  },
  {
    slug: "friendship",
    name: "Close Friendship",
    description: "Friendly, lively, supportive and natural.",
    prompt:
      "Write like a close friend: easygoing, upbeat, and grounded. Keep it conversational, authentic, and practical.",
    defaultIntensity: 0.7,
  },
  {
    slug: "casual",
    name: "Casual / Professional",
    description: "Neutral, polite, concise default for everyday chats.",
    prompt:
      "Write concise, polite, and calm replies. Keep emotional tone light and avoid overfamiliar language unless the other person leads with it.",
    defaultIntensity: 0.58,
  },
];

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0.7;
  }
  return Math.max(0, Math.min(value, 1));
}

function normalizeSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function fromStoredProfile(profile: Doc<"personalityProfiles">): PersonalityProfileView {
  const isDefault = DEFAULT_PERSONALITY_PROFILES.some((item) => item.slug === profile.slug);
  return {
    slug: profile.slug,
    name: profile.name,
    description: profile.description,
    prompt: profile.prompt,
    defaultIntensity: clamp01(profile.defaultIntensity),
    updatedAt: profile.updatedAt,
    createdAt: profile.createdAt,
    isDefault,
  };
}

function fromDefaultProfile(profile: DefaultPersonalityProfile): PersonalityProfileView {
  return {
    slug: profile.slug,
    name: profile.name,
    description: profile.description,
    prompt: profile.prompt,
    defaultIntensity: clamp01(profile.defaultIntensity),
    updatedAt: 0,
    createdAt: 0,
    isDefault: true,
  };
}

async function getMergedProfiles(ctx: QueryCtx | MutationCtx): Promise<PersonalityProfileView[]> {
  const storedProfiles = await ctx.db.query("personalityProfiles").withIndex("by_slug").take(100);
  const storedBySlug = new Map(storedProfiles.map((profile) => [profile.slug, profile]));

  const mergedDefaults = DEFAULT_PERSONALITY_PROFILES.map((profile) => {
    const stored = storedBySlug.get(profile.slug);
    return stored ? fromStoredProfile(stored) : fromDefaultProfile(profile);
  });

  const extras = storedProfiles
    .filter((profile) => !DEFAULT_PERSONALITY_PROFILES.some((item) => item.slug === profile.slug))
    .map(fromStoredProfile);

  return [...mergedDefaults, ...extras];
}

function getFallbackProfile(profiles: PersonalityProfileView[]) {
  return profiles.find((profile) => profile.slug === "casual") || profiles[0] || null;
}

export const listProfiles = query({
  args: {},
  handler: async (ctx) => {
    return await getMergedProfiles(ctx);
  },
});

export const upsertProfile = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    description: v.string(),
    prompt: v.string(),
    defaultIntensity: v.number(),
  },
  handler: async (ctx, args) => {
    const slug = normalizeSlug(args.slug);
    if (!slug) {
      throw new Error("Profile slug is required.");
    }

    const now = Date.now();
    const payload = {
      slug,
      name: args.name.trim(),
      description: args.description.trim(),
      prompt: args.prompt.trim(),
      defaultIntensity: clamp01(args.defaultIntensity),
      updatedAt: now,
    };

    const existing = await ctx.db
      .query("personalityProfiles")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }

    return await ctx.db.insert("personalityProfiles", {
      ...payload,
      createdAt: now,
    });
  },
});

export const getThreadSetting = query({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const profiles = await getMergedProfiles(ctx);
    const profileBySlug = new Map(profiles.map((profile) => [profile.slug, profile]));
    const fallbackProfile = getFallbackProfile(profiles);

    const setting = await ctx.db
      .query("threadPersonalitySettings")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first();

    if (!setting) {
      const fallback = fallbackProfile;
      return {
        threadId: args.threadId,
        profileSlug: fallback?.slug || "casual",
        intensity: clamp01(fallback?.defaultIntensity ?? 0.58),
        customPrompt: "",
        profile: fallback,
      };
    }

    const selectedProfile = profileBySlug.get(setting.profileSlug) || fallbackProfile;

    return {
      threadId: args.threadId,
      profileSlug: setting.profileSlug,
      intensity: clamp01(setting.intensity),
      customPrompt: setting.customPrompt || "",
      profile: selectedProfile,
      updatedAt: setting.updatedAt,
    };
  },
});

export const setThreadSetting = mutation({
  args: {
    threadId: v.id("threads"),
    profileSlug: v.string(),
    intensity: v.number(),
    customPrompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const profileSlug = normalizeSlug(args.profileSlug);
    if (!profileSlug) {
      throw new Error("Profile slug is required.");
    }

    const availableProfiles = await getMergedProfiles(ctx);
    const profileExists = availableProfiles.some((profile) => profile.slug === profileSlug);
    if (!profileExists) {
      throw new Error("Selected personality profile does not exist.");
    }

    const now = Date.now();
    const payload = {
      profileSlug,
      intensity: clamp01(args.intensity),
      customPrompt: args.customPrompt?.trim() || undefined,
      updatedAt: now,
    };

    const existing = await ctx.db
      .query("threadPersonalitySettings")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }

    return await ctx.db.insert("threadPersonalitySettings", {
      threadId: args.threadId,
      createdAt: now,
      ...payload,
    });
  },
});
