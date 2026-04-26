import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient, getConvexUrl } from "@/lib/convex-server";
import { hasInstanceSoulProfileContent } from "@/lib/instance-config";
import type { InstanceSetupPreferences, InstanceSoulPrivacy, InstanceSoulProfile } from "@/lib/instance-setup-types";

function resolveMimicryLevel(preset: InstanceSetupPreferences["mimicryPreset"]) {
  if (preset === "light") {
    return 0.56;
  }
  if (preset === "close") {
    return 0.82;
  }
  return 0.72;
}

function buildSoulPersonalityPrompt(profile: InstanceSoulProfile, privacy: InstanceSoulPrivacy) {
  const include = (field: keyof InstanceSoulProfile, label: string) =>
    privacy[field] === "ai_usable" && profile[field] ? `${label}: ${profile[field]}` : "";
  const lines = [
    include("useCase", "Primary use case"),
    include("genderIdentity", "Account owner's gender identity"),
    include("pronouns", "Account owner's pronouns"),
    include("romanticPreference", "Romantic preference"),
    include("relationshipStatus", "Relationship status"),
    include("romanticInterests", "Romantic interests and context"),
    include("cultureLocation", "Culture/location context"),
    include("selfDescription", "Self-understanding"),
    include("values", "Values to protect"),
    include("communicationStyle", "Natural communication style"),
    include("boundaries", "Boundaries"),
    include("relationships", "Important relationship context"),
    include("goals", "Current goals and direction"),
    include("dailyRhythm", "Daily rhythm"),
  ].filter(Boolean);

  return [
    "Write as the account owner's soul-aligned self: emotionally honest, grounded, and practical.",
    "Keep replies consistent with the user's stated identity, values, boundaries, relationships, romantic context, goals, and rhythm.",
    "Only use profile fields marked usable in AI replies. Never expose or overstate sensitive personal details unless the user clearly wants that context used.",
    "Do not invent personal facts beyond this profile. If a detail is unknown, stay neutral and ask only when needed.",
    "",
    ...lines,
  ].join("\n");
}

function buildSoulProfileDescription(profile: InstanceSoulProfile, privacy: InstanceSoulPrivacy) {
  if (privacy.values === "ai_usable" && profile.values) {
    return `Soul-aligned identity profile anchored on: ${profile.values.slice(0, 180)}`;
  }
  if (privacy.selfDescription === "ai_usable" && profile.selfDescription) {
    return `Soul-aligned identity profile: ${profile.selfDescription.slice(0, 180)}`;
  }
  return "Soul-aligned identity profile created during setup.";
}

export async function syncInstancePreferencesToConvex(preferences: InstanceSetupPreferences) {
  const url = getConvexUrl();
  if (!url) {
    return false;
  }

  const client = createConvexClient();
  await client.mutation(convexRefs.settingsSaveOnboardingPreset, {
    autonomyMode: preferences.autonomyMode,
    replyPace: preferences.replyPace,
    quietHoursEnabled: preferences.quietHoursEnabled,
    quietHoursStartHour: preferences.quietHoursStartHour,
    quietHoursEndHour: preferences.quietHoursEndHour,
    memesEnabled: preferences.memesEnabled,
  });
  await client.mutation(convexRefs.styleSetMimicry, {
    mimicryLevel: resolveMimicryLevel(preferences.mimicryPreset),
  });
  if (hasInstanceSoulProfileContent(preferences.soulProfile)) {
    await client.mutation(convexRefs.personalityUpsertProfile, {
      slug: "soul",
      name: "Soul",
      description: buildSoulProfileDescription(preferences.soulProfile, preferences.soulPrivacy),
      prompt: buildSoulPersonalityPrompt(preferences.soulProfile, preferences.soulPrivacy),
      defaultIntensity: preferences.mimicryPreset === "close" ? 0.82 : preferences.mimicryPreset === "light" ? 0.58 : 0.7,
    });
  }
  return true;
}
