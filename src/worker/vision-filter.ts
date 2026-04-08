import type { ParsedInboundMessage } from "./whatsapp";

export type VisionFilterMode = "all" | "none" | "smart";

export type VisionFilterDecision = {
  allow: boolean;
  mode: VisionFilterMode;
  reason:
    | "non_image_kind"
    | "mode_all"
    | "mode_none"
    | "caption_signal"
    | "caption_low_signal"
    | "caption_descriptive"
    | "uncaptioned_periodic_sample"
    | "uncaptioned_throttled";
  score: number;
  signals: string[];
};

type VisionFilterEnv = Record<string, string | undefined>;

const DEFAULT_UNCAPTIONED_COOLDOWN_MS = 90 * 60 * 1000;

const HIGH_SIGNAL_PATTERNS = [
  /\?/,
  /\b(what|which|who|where|why|how|read|translate|summari[sz]e|identify|guess|explain|rate|opinion|thoughts?)\b/i,
  /\b(look|see|check|watch|notice|spot)\b/i,
  /\b(screenshot|receipt|invoice|error|bug|alert|chart|graph|result|proof|contract|document)\b/i,
  /\b(status|story|update|meme|joke|funny|news)\b/i,
];

const LOW_SIGNAL_PATTERNS = [
  /^(lol|lmao|haha+|ok|okay|k|kk|nice|cool|wow|omg|seen|fine|alright)$/i,
  /^[\u{1F602}\u{1F923}\u{1F605}\u{1F525}\u{1F44D}\u{1F64F}]+$/u,
];

function parsePositiveInt(raw: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.round(Math.max(min, Math.min(parsed, max)));
}

function normalizeCaption(raw: string | undefined) {
  return (raw || "").replace(/\s+/g, " ").trim();
}

export function readVisionFilterModeFromEnv(env: VisionFilterEnv = process.env): VisionFilterMode {
  const raw = (env.SLM_VISION_FILTER_MODE || "smart").trim().toLowerCase();
  if (raw === "all" || raw === "none" || raw === "smart") {
    return raw;
  }
  return "smart";
}

export function readVisionFilterUncaptionedCooldownMsFromEnv(env: VisionFilterEnv = process.env): number {
  return parsePositiveInt(env.SLM_VISION_FILTER_UNCAPTIONED_COOLDOWN_MS, DEFAULT_UNCAPTIONED_COOLDOWN_MS, 60_000, 24 * 60 * 60 * 1000);
}

export function decideInboundVisionAnalysis(args: {
  parsed: ParsedInboundMessage;
  mode: VisionFilterMode;
  nowMs: number;
  lastAllowedAtMs?: number;
  uncaptionedCooldownMs: number;
}): VisionFilterDecision {
  if (args.parsed.kind !== "image") {
    return {
      allow: true,
      mode: args.mode,
      reason: "non_image_kind",
      score: 0,
      signals: [],
    };
  }

  if (args.mode === "all") {
    return {
      allow: true,
      mode: args.mode,
      reason: "mode_all",
      score: 10,
      signals: ["vision_filter_mode_all"],
    };
  }

  if (args.mode === "none") {
    return {
      allow: false,
      mode: args.mode,
      reason: "mode_none",
      score: -10,
      signals: ["vision_filter_mode_none"],
    };
  }

  const caption = normalizeCaption(args.parsed.caption);
  const signals: string[] = [];
  let score = 0;

  if (caption) {
    for (const pattern of HIGH_SIGNAL_PATTERNS) {
      if (pattern.test(caption)) {
        signals.push("caption_signal");
        score += 2;
        break;
      }
    }

    if (caption.length >= 36) {
      signals.push("descriptive_caption");
      score += 1;
    }

    if (LOW_SIGNAL_PATTERNS.some((pattern) => pattern.test(caption))) {
      signals.push("low_signal_caption");
      score -= 2;
    }

    if (score >= 2) {
      return {
        allow: true,
        mode: args.mode,
        reason: "caption_signal",
        score,
        signals,
      };
    }

    if (score >= 1) {
      return {
        allow: true,
        mode: args.mode,
        reason: "caption_descriptive",
        score,
        signals,
      };
    }

    return {
      allow: false,
      mode: args.mode,
      reason: "caption_low_signal",
      score,
      signals,
    };
  }

  const lastAllowedAt = Number.isFinite(args.lastAllowedAtMs) ? (args.lastAllowedAtMs as number) : 0;
  const elapsed = lastAllowedAt > 0 ? args.nowMs - lastAllowedAt : Number.POSITIVE_INFINITY;
  if (elapsed >= args.uncaptionedCooldownMs) {
    return {
      allow: true,
      mode: args.mode,
      reason: "uncaptioned_periodic_sample",
      score: 1,
      signals: ["uncaptioned_periodic_sample"],
    };
  }

  return {
    allow: false,
    mode: args.mode,
    reason: "uncaptioned_throttled",
    score: 0,
    signals: ["uncaptioned_throttled"],
  };
}
