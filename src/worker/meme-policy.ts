import { assessProfessionalConversation, type MemePolicyMode } from "../../convex/lib/memePolicy";

export type MemeAssetSource = "generated_cache" | "generated_fresh" | "uploaded_fallback" | "none";

export function evaluateProfessionalMemeGuard(args: {
  memePolicyMode?: MemePolicyMode;
  historyMessages: Array<{ text: string; direction: "inbound" | "outbound"; messageType?: string }>;
  latestInboundText: string;
}) {
  const mode = args.memePolicyMode || "auto";
  const assessment = assessProfessionalConversation({
    messages: args.historyMessages,
    latestInboundText: args.latestInboundText,
  });

  if (mode === "always_block") {
    return {
      blocked: true,
      mode,
      assessment,
      reason: "manual_always_block",
    };
  }

  if (mode === "always_allow") {
    return {
      blocked: false,
      mode,
      assessment,
      reason: "manual_always_allow",
    };
  }

  return {
    blocked: assessment.isProfessional,
    mode,
    assessment,
    reason: assessment.isProfessional ? "auto_professional_detected" : "auto_non_professional",
  };
}

export function evaluateMemeTimingGate(args: {
  nowMs: number;
  lastMemeSentAtMs?: number;
  cooldownMs: number;
  probability: number;
  randomValue: number;
}) {
  const cooldownMs = Math.max(0, args.cooldownMs);
  const probability = Math.max(0, Math.min(1, args.probability));
  const lastAt = args.lastMemeSentAtMs || 0;
  const inCooldown = lastAt > 0 && args.nowMs - lastAt < cooldownMs;
  const probabilityPass = args.randomValue <= probability;

  return {
    pass: !inCooldown && probabilityPass,
    inCooldown,
    probabilityPass,
    probability,
  };
}

export async function resolveMemeAssetWithFallback(args: {
  pickGeneratedCached: () => Promise<string | undefined>;
  generateFresh: () => Promise<string | undefined>;
  pickUploadedFallback: () => Promise<string | undefined>;
}) {
  const cached = await args.pickGeneratedCached();
  if (cached) {
    return {
      assetId: cached,
      source: "generated_cache" as MemeAssetSource,
    };
  }

  const generated = await args.generateFresh();
  if (generated) {
    return {
      assetId: generated,
      source: "generated_fresh" as MemeAssetSource,
    };
  }

  const fallback = await args.pickUploadedFallback();
  if (fallback) {
    return {
      assetId: fallback,
      source: "uploaded_fallback" as MemeAssetSource,
    };
  }

  return {
    assetId: undefined,
    source: "none" as MemeAssetSource,
  };
}

