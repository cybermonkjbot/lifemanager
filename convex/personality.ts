import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { setConfigValue, getConfig } from "./lib/config";
import { DEFAULT_PERSONA_PACK_ID, PERSONA_PACKS, getPersonaPackById } from "./lib/personaPacks";

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

type PromptProfileSource = "manual" | "auto";

const MAX_PROMPT_PROFILE_CHARS = 2400;
const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

const DEFAULT_PERSONALITY_PROFILES: DefaultPersonalityProfile[] = [
  {
    slug: "girlfriend",
    name: "Girlfriend / Boyfriend",
    description: "Affectionate, intimate, and unmistakably you with partner-safe boundaries.",
    prompt:
      "Write with affectionate warmth and emotional attentiveness in the account owner's natural voice. Let care and intimacy come through while respecting real boundaries, and keep flirty energy natural and context-aware.",
    defaultIntensity: 0.86,
  },
  {
    slug: "relationship",
    name: "Romantic Relationship",
    description: "Emotionally invested and thoughtful, rooted in your real values and tone.",
    prompt:
      "Write with steady warmth and relationship-minded care in the account owner's authentic voice. Be emotionally present, considerate, and clear about intentions while keeping healthy boundaries and avoiding drama.",
    defaultIntensity: 0.78,
  },
  {
    slug: "friendship",
    name: "Close Friendship",
    description: "Friendly, lively, and genuinely you with close friends.",
    prompt:
      "Write like this account owner's real close-friend self: easygoing, upbeat, and grounded. Keep it conversational, authentic, practical, and aligned with their normal wording and boundaries.",
    defaultIntensity: 0.7,
  },
  {
    slug: "casual",
    name: "Casual / Professional",
    description: "Calm, polite, concise, and still personal to your identity.",
    prompt:
      "Write concise, polite, and calm replies in the account owner's natural voice. Keep emotional tone light, stay practical, and avoid overfamiliar language unless the other person clearly leads with it.",
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

function normalizePromptProfile(value: string | undefined) {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.slice(0, MAX_PROMPT_PROFILE_CHARS);
}

function normalizeCompactText(value: string | undefined, maxChars: number) {
  const compact = (value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) {
    return "";
  }
  return compact.slice(0, maxChars);
}

function mergeUniqueLimited(base: string[], additions: string[], limit: number) {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const item of [...base, ...additions]) {
    const normalized = normalizeCompactText(item, 280);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(normalized);
    if (merged.length >= limit) {
      break;
    }
  }
  return merged;
}

function buildPersonaPackBlock(packId: string, promptBlock: string) {
  const markerStart = `[persona-pack:${packId}:start]`;
  const markerEnd = `[persona-pack:${packId}:end]`;
  return `${markerStart}\n${promptBlock.trim()}\n${markerEnd}`;
}

function upsertPersonaPackPromptBlock(existingPrompt: string, packId: string, promptBlock: string) {
  const markerStart = `[persona-pack:${packId}:start]`;
  const markerEnd = `[persona-pack:${packId}:end]`;
  const blockPattern = new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`, "g");
  const withoutExistingBlock = existingPrompt.replace(blockPattern, "").trim();
  const nextBlock = buildPersonaPackBlock(packId, promptBlock);
  if (!withoutExistingBlock) {
    return nextBlock;
  }
  return `${withoutExistingBlock}\n\n${nextBlock}`.trim();
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

async function getNextProfileVersionNumber(ctx: QueryCtx | MutationCtx, profileSlug: string) {
  const latest = await ctx.db
    .query("personalityProfileVersions")
    .withIndex("by_profileSlug_and_versionNumber", (q) => q.eq("profileSlug", profileSlug))
    .order("desc")
    .take(1);
  const currentMax = latest[0]?.versionNumber || 0;
  return currentMax + 1;
}

async function saveProfileVersionSnapshot(
  ctx: MutationCtx,
  profile: Doc<"personalityProfiles">,
  reason?: string,
) {
  const versionNumber = await getNextProfileVersionNumber(ctx, profile.slug);
  await ctx.db.insert("personalityProfileVersions", {
    profileSlug: profile.slug,
    versionNumber,
    name: profile.name,
    description: profile.description,
    prompt: profile.prompt,
    defaultIntensity: clamp01(profile.defaultIntensity),
    reason: reason?.trim() || undefined,
    createdAt: Date.now(),
  });
  return versionNumber;
}

async function ensureThreadSetting(
  ctx: MutationCtx,
  threadId: Doc<"threadPersonalitySettings">["threadId"],
) {
  const existing = await ctx.db
    .query("threadPersonalitySettings")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .first();
  if (existing) {
    return existing;
  }

  const profiles = await getMergedProfiles(ctx);
  const fallbackProfile = getFallbackProfile(profiles);
  const now = Date.now();
  const id = await ctx.db.insert("threadPersonalitySettings", {
    threadId,
    profileSlug: fallbackProfile?.slug || "casual",
    intensity: clamp01(fallbackProfile?.defaultIntensity ?? 0.58),
    createdAt: now,
    updatedAt: now,
  });

  return {
    _id: id,
    _creationTime: now,
    threadId,
    profileSlug: fallbackProfile?.slug || "casual",
    intensity: clamp01(fallbackProfile?.defaultIntensity ?? 0.58),
    createdAt: now,
    updatedAt: now,
  };
}

function countWords(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function extractRepeatedShortPhrases(messages: Doc<"messages">[]) {
  const counts = new Map<string, number>();
  for (const message of messages) {
    const normalized = normalizeCompactText(
      message.text
        .toLowerCase()
        .replace(/https?:\/\/\S+/g, "")
        .replace(/[^a-z0-9\s'!?]/g, " "),
      80,
    );
    if (!normalized) {
      continue;
    }
    const words = normalized.split(" ");
    if (words.length < 2 || words.length > 9) {
      continue;
    }
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .slice(0, 4)
    .map(([phrase]) => phrase);
}

function extractCommonGreetingPrefixes(messages: Doc<"messages">[]) {
  const prefixes = [
    "hey",
    "hi",
    "hello",
    "yo",
    "sup",
    "good morning",
    "good afternoon",
    "good evening",
    "babe",
    "love",
    "dear",
  ];
  const counts = new Map<string, number>();
  for (const message of messages) {
    const lowered = normalizeCompactText(message.text.toLowerCase(), 80);
    if (!lowered) {
      continue;
    }
    const matched = prefixes.find((prefix) => lowered === prefix || lowered.startsWith(`${prefix} `));
    if (!matched) {
      continue;
    }
    counts.set(matched, (counts.get(matched) || 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([prefix]) => prefix);
}

function describeLengthStyle(avgWords: number) {
  if (avgWords <= 6) {
    return "Keep replies very short, around one compact sentence by default.";
  }
  if (avgWords <= 12) {
    return "Keep replies short and direct, usually one or two brief sentences.";
  }
  if (avgWords <= 20) {
    return "Use medium-length replies with enough detail to feel thoughtful.";
  }
  return "Longer replies are normal in this chat when context needs depth.";
}

function describeEmojiStyle(emojiMessageRate: number) {
  if (emojiMessageRate >= 0.45) {
    return "Emojis are common in this conversation; use them naturally where they add warmth.";
  }
  if (emojiMessageRate >= 0.2) {
    return "Use occasional emojis, but do not overload each message.";
  }
  return "Keep emoji usage minimal unless the other person leads with it.";
}

function describeEnergyStyle(exclamationRate: number) {
  if (exclamationRate >= 0.35) {
    return "Energetic punctuation is part of the style; an occasional exclamation mark is fine.";
  }
  if (exclamationRate <= 0.08) {
    return "Punctuation stays calm; avoid overusing exclamation marks.";
  }
  return "Keep punctuation balanced and avoid extremes.";
}

function describeQuestionStyle(questionRate: number) {
  if (questionRate >= 0.35) {
    return "Asking follow-up questions is normal here; include one when it helps move the chat forward.";
  }
  if (questionRate <= 0.12) {
    return "Questions are used sparingly; prioritize clear statements unless a question is needed.";
  }
  return "Use questions selectively and only when they feel natural.";
}

function buildAutoPromptProfile(messages: Doc<"messages">[], syncedHistoryCount: number) {
  const outbound = messages.filter((message) => message.direction === "outbound" && normalizeCompactText(message.text, 800));
  const inboundCount = messages.length - outbound.length;

  if (outbound.length === 0) {
    const fallback = [
      "Use this conversation-specific style guide.",
      syncedHistoryCount > 0
        ? `- Built from all available conversation history, including ${syncedHistoryCount} WhatsApp synced history messages.`
        : "- Built from all available conversation history.",
      "- Keep the tone warm, clear, and grounded.",
      "- Stay concise unless extra detail is clearly needed.",
      "- Mirror the contact's current mood and pace.",
    ].join("\n");

    return {
      promptProfile: fallback,
      messageCount: messages.length,
      outboundCount: 0,
      inboundCount,
    };
  }

  let totalWords = 0;
  let emojiMessages = 0;
  let questionMessages = 0;
  let exclamationMessages = 0;

  for (const message of outbound) {
    const text = message.text || "";
    totalWords += countWords(text);
    if (EMOJI_REGEX.test(text)) {
      emojiMessages += 1;
    }
    if (text.includes("?")) {
      questionMessages += 1;
    }
    if (text.includes("!")) {
      exclamationMessages += 1;
    }
    EMOJI_REGEX.lastIndex = 0;
  }

  const averageWords = totalWords / Math.max(outbound.length, 1);
  const emojiRate = emojiMessages / Math.max(outbound.length, 1);
  const questionRate = questionMessages / Math.max(outbound.length, 1);
  const exclamationRate = exclamationMessages / Math.max(outbound.length, 1);
  const repeatedPhrases = extractRepeatedShortPhrases(outbound);
  const greetings = extractCommonGreetingPrefixes(outbound);

  const lines = [
    "Use this conversation-specific style guide.",
    syncedHistoryCount > 0
      ? `- Built from all available conversation history (${messages.length} total messages, ${outbound.length} sent by me), including ${syncedHistoryCount} WhatsApp synced history messages.`
      : `- Built from all available conversation history (${messages.length} messages, ${outbound.length} sent by me).`,
    `- ${describeLengthStyle(averageWords)}`,
    `- ${describeEmojiStyle(emojiRate)}`,
    `- ${describeEnergyStyle(exclamationRate)}`,
    `- ${describeQuestionStyle(questionRate)}`,
    greetings.length > 0 ? `- Common greeting style: ${greetings.join(", ")}.` : "",
    repeatedPhrases.length > 0
      ? `- Reuse these familiar phrases only when context fits: ${repeatedPhrases.map((phrase) => `"${phrase}"`).join(", ")}.`
      : "",
    "- Keep the relationship dynamic consistent and avoid sudden tone shifts.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    promptProfile: lines.slice(0, MAX_PROMPT_PROFILE_CHARS),
    messageCount: messages.length,
    outboundCount: outbound.length,
    inboundCount,
  };
}

async function savePromptProfile(
  ctx: MutationCtx,
  args: {
    threadId: Doc<"threadPersonalitySettings">["threadId"];
    promptProfile: string;
    source?: PromptProfileSource;
    lookbackDays?: number;
    messageCount?: number;
  },
) {
  const setting = await ensureThreadSetting(ctx, args.threadId);
  const now = Date.now();
  const promptProfile = normalizePromptProfile(args.promptProfile);

  if (!promptProfile) {
    await ctx.db.patch(setting._id, {
      threadPromptProfile: undefined,
      threadPromptProfileSource: undefined,
      threadPromptProfileLookbackDays: undefined,
      threadPromptProfileMessageCount: undefined,
      threadPromptProfileUpdatedAt: undefined,
      updatedAt: now,
    });
    return setting._id;
  }

  await ctx.db.patch(setting._id, {
    threadPromptProfile: promptProfile,
    threadPromptProfileSource: args.source,
    threadPromptProfileLookbackDays: args.lookbackDays,
    threadPromptProfileMessageCount: args.messageCount,
    threadPromptProfileUpdatedAt: now,
    updatedAt: now,
  });
  return setting._id;
}

export const listProfiles = query({
  args: {},
  handler: async (ctx) => {
    return await getMergedProfiles(ctx);
  },
});

export const listPersonaPacks = query({
  args: {},
  handler: async (ctx) => {
    const config = await getConfig(ctx);
    return {
      activePersonaPackId: config.activePersonaPackId || "",
      qualityGateMode: config.qualityGateMode,
      qualityGateThreshold: config.qualityGateThreshold,
      packs: PERSONA_PACKS.map((pack) => ({
        id: pack.id,
        name: pack.name,
        version: pack.version,
        description: pack.description,
        allowedProfileSlugs: pack.activation.allowedProfileSlugs,
      })),
    };
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
      const changed =
        existing.name !== payload.name ||
        existing.description !== payload.description ||
        existing.prompt !== payload.prompt ||
        Math.abs(clamp01(existing.defaultIntensity) - payload.defaultIntensity) >= 0.0001;

      if (changed) {
        await saveProfileVersionSnapshot(ctx, existing, "pre-update");
      }
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }

    const profileId = await ctx.db.insert("personalityProfiles", {
      ...payload,
      createdAt: now,
    });
    const created = await ctx.db.get(profileId);
    if (created) {
      await saveProfileVersionSnapshot(ctx, created, "initial");
    }
    return profileId;
  },
});

export const listProfileVersions = query({
  args: {
    slug: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const slug = normalizeSlug(args.slug);
    if (!slug) {
      return [];
    }
    const limit = Math.max(1, Math.min(Math.round(args.limit ?? 20), 100));
    return await ctx.db
      .query("personalityProfileVersions")
      .withIndex("by_profileSlug_and_createdAt", (q) => q.eq("profileSlug", slug))
      .order("desc")
      .take(limit);
  },
});

export const rollbackProfileVersion = mutation({
  args: {
    slug: v.string(),
    versionId: v.id("personalityProfileVersions"),
  },
  handler: async (ctx, args) => {
    const slug = normalizeSlug(args.slug);
    if (!slug) {
      throw new Error("Profile slug is required.");
    }

    const profile = await ctx.db
      .query("personalityProfiles")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!profile) {
      throw new Error("Profile not found.");
    }

    const version = await ctx.db.get(args.versionId);
    if (!version || version.profileSlug !== slug) {
      throw new Error("Profile version not found.");
    }

    await saveProfileVersionSnapshot(ctx, profile, `rollback-from-v${version.versionNumber}`);

    await ctx.db.patch(profile._id, {
      name: version.name,
      description: version.description,
      prompt: version.prompt,
      defaultIntensity: clamp01(version.defaultIntensity),
      updatedAt: Date.now(),
    });

    return profile._id;
  },
});

export const deleteProfile = mutation({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const slug = normalizeSlug(args.slug);
    if (!slug) {
      throw new Error("Profile slug is required.");
    }

    if (DEFAULT_PERSONALITY_PROFILES.some((profile) => profile.slug === slug)) {
      throw new Error("Default profiles cannot be deleted.");
    }

    const existing = await ctx.db
      .query("personalityProfiles")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!existing) {
      return null;
    }

    const fallback = getFallbackProfile(await getMergedProfiles(ctx));
    const now = Date.now();
    const settings = await ctx.db
      .query("threadPersonalitySettings")
      .withIndex("by_profileSlug", (q) => q.eq("profileSlug", slug))
      .take(4000);
    for (const setting of settings) {
      await ctx.db.patch(setting._id, {
        profileSlug: fallback?.slug || "casual",
        intensity: clamp01(fallback?.defaultIntensity ?? 0.58),
        updatedAt: now,
      });
    }

    await ctx.db.delete(existing._id);
    return existing._id;
  },
});

export const installPersonaPack = mutation({
  args: {
    packId: v.optional(v.string()),
    autoActivate: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const selectedPackId = (args.packId || DEFAULT_PERSONA_PACK_ID).trim();
    const pack = getPersonaPackById(selectedPackId);
    if (!pack) {
      throw new Error("Persona pack not found.");
    }

    const now = Date.now();
    const styleProfile = await ctx.db
      .query("styleProfiles")
      .withIndex("by_scope", (q) => q.eq("scope", "global"))
      .first();

    if (styleProfile) {
      const nextCommonPhrases = mergeUniqueLimited(styleProfile.commonPhrases || [], pack.styleTraits.commonPhrases, 40);
      const nextPunctuationStyle = mergeUniqueLimited(styleProfile.punctuationStyle || [], pack.styleTraits.punctuationStyle, 30);
      const nextHumorNotes = mergeUniqueLimited(styleProfile.humorNotes || [], pack.styleTraits.humorNotes, 30);
      const nextSpellingNotes = mergeUniqueLimited(styleProfile.spellingNotes || [], pack.styleTraits.spellingNotes, 30);

      const styleChanged =
        JSON.stringify(nextCommonPhrases) !== JSON.stringify(styleProfile.commonPhrases || []) ||
        JSON.stringify(nextPunctuationStyle) !== JSON.stringify(styleProfile.punctuationStyle || []) ||
        JSON.stringify(nextHumorNotes) !== JSON.stringify(styleProfile.humorNotes || []) ||
        JSON.stringify(nextSpellingNotes) !== JSON.stringify(styleProfile.spellingNotes || []);

      if (styleChanged) {
        await ctx.db.insert("styleProfileHistory", {
          scope: styleProfile.scope,
          threadId: styleProfile.threadId,
          mimicryLevel: styleProfile.mimicryLevel,
          commonPhrases: styleProfile.commonPhrases || [],
          punctuationStyle: styleProfile.punctuationStyle || [],
          humorNotes: styleProfile.humorNotes || [],
          spellingNotes: styleProfile.spellingNotes || [],
          reason: `pre-persona-pack-install:${pack.id}`,
          createdAt: now,
        });
        await ctx.db.patch(styleProfile._id, {
          commonPhrases: nextCommonPhrases,
          punctuationStyle: nextPunctuationStyle,
          humorNotes: nextHumorNotes,
          spellingNotes: nextSpellingNotes,
          updatedAt: now,
        });
      }
    } else {
      await ctx.db.insert("styleProfiles", {
        scope: "global",
        mimicryLevel: 0.72,
        commonPhrases: mergeUniqueLimited([], pack.styleTraits.commonPhrases, 40),
        punctuationStyle: mergeUniqueLimited([], pack.styleTraits.punctuationStyle, 30),
        humorNotes: mergeUniqueLimited([], pack.styleTraits.humorNotes, 30),
        spellingNotes: mergeUniqueLimited([], pack.styleTraits.spellingNotes, 30),
        updatedAt: now,
      });
    }

    let profileUpdates = 0;
    for (const slug of pack.personalityPatch.appendToSlugs) {
      const existing = await ctx.db
        .query("personalityProfiles")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .first();
      const defaultProfile = DEFAULT_PERSONALITY_PROFILES.find((profile) => profile.slug === slug);
      const currentPrompt = existing?.prompt || defaultProfile?.prompt || "";
      const nextPrompt = upsertPersonaPackPromptBlock(currentPrompt, pack.id, pack.personalityPatch.promptBlock);

      if (existing) {
        if (existing.prompt === nextPrompt) {
          continue;
        }
        await saveProfileVersionSnapshot(ctx, existing, `pre-persona-pack-install:${pack.id}`);
        await ctx.db.patch(existing._id, {
          prompt: nextPrompt,
          updatedAt: now,
        });
        profileUpdates += 1;
        continue;
      }

      const profileId = await ctx.db.insert("personalityProfiles", {
        slug,
        name: defaultProfile?.name || slug,
        description: defaultProfile?.description || "Persona-managed profile.",
        prompt: nextPrompt,
        defaultIntensity: clamp01(defaultProfile?.defaultIntensity ?? 0.7),
        createdAt: now,
        updatedAt: now,
      });
      const created = await ctx.db.get(profileId);
      if (created) {
        await saveProfileVersionSnapshot(ctx, created, `persona-pack-install:${pack.id}`);
      }
      profileUpdates += 1;
    }

    const autoActivate = args.autoActivate ?? true;
    if (autoActivate) {
      await setConfigValue(ctx, "activePersonaPackId", pack.id);
      await setConfigValue(ctx, "qualityGateMode", "auto_rewrite_once");
      await setConfigValue(ctx, "qualityGateThreshold", String(pack.checklist.passThreshold));
    }
    await setConfigValue(ctx, "personaPackLastInstalledAt", String(now));

    await ctx.db.insert("systemEvents", {
      source: "dashboard",
      eventType: "persona.pack.installed",
      detail: `Installed ${pack.id} (autoActivate=${autoActivate ? "true" : "false"})`,
      createdAt: now,
    });

    return {
      packId: pack.id,
      autoActivate,
      profileUpdates,
      installedAt: now,
    };
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
        threadPromptProfile: "",
        threadPromptProfileSource: undefined,
        threadPromptProfileLookbackDays: undefined,
        threadPromptProfileMessageCount: undefined,
        threadPromptProfileUpdatedAt: undefined,
        profile: fallback,
      };
    }

    const selectedProfile = profileBySlug.get(setting.profileSlug) || fallbackProfile;

    return {
      threadId: args.threadId,
      profileSlug: setting.profileSlug,
      intensity: clamp01(setting.intensity),
      customPrompt: setting.customPrompt || "",
      threadPromptProfile: setting.threadPromptProfile || "",
      threadPromptProfileSource: setting.threadPromptProfileSource,
      threadPromptProfileLookbackDays: setting.threadPromptProfileLookbackDays,
      threadPromptProfileMessageCount: setting.threadPromptProfileMessageCount,
      threadPromptProfileUpdatedAt: setting.threadPromptProfileUpdatedAt,
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

export const setThreadPromptProfile = mutation({
  args: {
    threadId: v.id("threads"),
    promptProfile: v.string(),
  },
  handler: async (ctx, args) => {
    return await savePromptProfile(ctx, {
      threadId: args.threadId,
      promptProfile: args.promptProfile,
      source: "manual",
    });
  },
});

export const autoBuildThreadPromptProfile = mutation({
  args: {
    threadId: v.id("threads"),
    lookbackDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const messages: Doc<"messages">[] = [];
    const source = ctx.db
      .query("messages")
      .withIndex("by_thread_messageAt", (q) => q.eq("threadId", args.threadId));
    let syncedHistoryCount = 0;
    for await (const message of source) {
      if (message.origin === "history_sync" || message.origin === "history_fetch") {
        syncedHistoryCount += 1;
      }
      messages.push(message);
    }

    if (messages.length === 0) {
      throw new Error("No conversation messages found for this thread.");
    }

    const profile = buildAutoPromptProfile(messages, syncedHistoryCount);
    const settingId = await savePromptProfile(ctx, {
      threadId: args.threadId,
      promptProfile: profile.promptProfile,
      source: "auto",
      messageCount: profile.messageCount,
    });

    return {
      settingId,
      promptProfile: profile.promptProfile,
      messageCount: profile.messageCount,
      outboundCount: profile.outboundCount,
      inboundCount: profile.inboundCount,
    };
  },
});
