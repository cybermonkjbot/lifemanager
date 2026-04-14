export type CallFallbackSessionSnapshot = {
  lastStatus?: string;
  acceptedAt?: number;
};

export const DEFAULT_CALL_AUTO_DECLINE_FALLBACK_VARIANTS = [
  "I can't take WhatsApp calls here right now. Please send a message and I'll reply here.",
  "I'm not able to take WhatsApp calls right now. Send me a message and I'll reply here.",
  "Can't do WhatsApp calls at the moment. Text me here and I'll get back to you.",
  "I can't pick WhatsApp calls right now. Drop a message here and I'll reply soon.",
];

function stableHash(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function normalizeVariants(values: Array<string | undefined | null>) {
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = (value || "").trim();
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
}

export function resolveCallFallbackVariants(args?: {
  overrideText?: string | null;
  overrideVariants?: string | null;
}) {
  const overrideVariantText = (args?.overrideVariants || "").trim();
  if (overrideVariantText) {
    const parsed = overrideVariantText
      .split(/\r?\n|\|\|/g)
      .map((item) => item.trim())
      .filter(Boolean);
    const normalized = normalizeVariants(parsed);
    if (normalized.length > 0) {
      return normalized;
    }
  }

  const overrideSingleText = (args?.overrideText || "").trim();
  if (overrideSingleText) {
    return [overrideSingleText];
  }

  return [...DEFAULT_CALL_AUTO_DECLINE_FALLBACK_VARIANTS];
}

export function selectCallFallbackVariant(args: {
  variants: string[];
  seed: string;
}) {
  const variants = normalizeVariants(args.variants);
  if (variants.length === 0) {
    return "";
  }
  if (variants.length === 1) {
    return variants[0];
  }
  const index = stableHash(args.seed) % variants.length;
  return variants[index];
}

export function shouldSuppressCallFallbackAfterOffer(
  snapshot: CallFallbackSessionSnapshot | null | undefined,
) {
  if (!snapshot) {
    return false;
  }

  if (Number.isFinite(snapshot.acceptedAt) && (snapshot.acceptedAt || 0) > 0) {
    return true;
  }

  const status = (snapshot.lastStatus || "").trim().toLowerCase();
  return status === "accept";
}
