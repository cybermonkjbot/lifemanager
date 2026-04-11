import type { RomanceMorningMode } from "../../shared/romance-morning";

type OutreachMode = "proactive" | "good_morning";
type GhostReopenTone = "naija_tease" | "hard_banter" | "playful" | "warm";
type GhostSeverity = "mild" | "severe";

const LEAD_MODE_INTENT_LINES = [
  "Lead with warmth and initiative by proposing one simple plan for later today.",
  "Lead the opener with affectionate momentum and one concrete invite.",
  "Set a romantic direction for the day with one grounded plan idea.",
];

const WARM_MODE_INTENT_LINES = [
  "Lead with soft affection and emotional presence before any practical topic.",
  "Keep the opener sweet, grounded, and emotionally attentive.",
  "Start with caring warmth and one gentle, natural check-in question.",
];

function normalizeVariant(variant: number | undefined) {
  const resolved = Math.round(variant ?? 0);
  return ((resolved % 3) + 3) % 3;
}

function resolveRomanceIntentLine(args: {
  mode: RomanceMorningMode;
  variant: number | undefined;
}) {
  const variant = normalizeVariant(args.variant);
  return args.mode === "lead" ? LEAD_MODE_INTENT_LINES[variant] : WARM_MODE_INTENT_LINES[variant];
}

export function buildOutreachPromptSeed(args: {
  outreachMode: OutreachMode;
  romanceMorningMode?: RomanceMorningMode;
  romancePromptVariant?: number;
  ghostReopenInstruction?: string;
  memorySummary?: string;
  contactName: string;
}) {
  if (args.outreachMode === "good_morning") {
    return [
      "Write one adaptive good-morning opener for this romantic contact.",
      `Mode: ${args.romanceMorningMode || "warm"}.`,
      resolveRomanceIntentLine({
        mode: args.romanceMorningMode || "warm",
        variant: args.romancePromptVariant,
      }),
      "Keep it to 1-2 short sentences in natural chat language.",
      "No robotic, assistant, task-manager, or sales wording.",
      "At most one gentle question and at most one emoji.",
      "No guilt, pressure, jealousy cues, or accusatory tone.",
      args.memorySummary,
      `Contact first name: ${args.contactName}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "Proactively start a fresh check-in conversation with this contact now.",
    "Use previous chat context so the opener feels natural, specific, and warm.",
    "Keep it to 1-2 short sentences, avoid sounding robotic, and include exactly one gentle question.",
    "Do not sound needy, accusatory, or passive-aggressive.",
    args.ghostReopenInstruction,
    args.memorySummary,
    `Contact first name: ${args.contactName}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildOutreachFallbackText(args: {
  outreachMode: OutreachMode;
  romanceMorningMode?: RomanceMorningMode;
  longSilenceGhostReopen: boolean;
  ghostReopenTone: GhostReopenTone;
  ghostSeverity: GhostSeverity;
}) {
  if (args.outreachMode === "good_morning") {
    if (args.romanceMorningMode === "lead") {
      return "Good morning, I want to make today sweet for us. What time works for a quick plan later?";
    }
    return "Good morning, sending you warm energy. How are you feeling this morning?";
  }

  if (!args.longSilenceGhostReopen) {
    return "Hey, just checking in. How is your day going?";
  }

  if (args.ghostReopenTone === "naija_tease") {
    return args.ghostSeverity === "severe"
      ? "Shey you ghost me finish abi 😭. Hope you dey alright?"
      : "Shey you ghost me abi 😄. How have you been lately?";
  }
  if (args.ghostReopenTone === "hard_banter") {
    return args.ghostSeverity === "severe"
      ? "You sly mf, you ghosted me 😭. You good though?"
      : "You sly one, you ghosted me small 😅. You good?";
  }
  if (args.ghostReopenTone === "playful") {
    return args.ghostSeverity === "severe"
      ? "Omo, you ghosted me hard 😭. How have you been though?"
      : "You ghosted me small 😅. How have you been?";
  }
  return args.ghostSeverity === "severe"
    ? "You really disappeared on me 😅. Hope you're doing well?"
    : "You ghosted me a little 😅. How have you been lately?";
}
