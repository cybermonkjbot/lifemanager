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

const CALL_FALLBACK_CALLER_TOKEN_PATTERN = /\{+\s*(?:caller(?:Name)?|name)\s*\}+/gi;
const DEFAULT_CALL_AUTO_REJECT_MIN_MS = 8_000;
const DEFAULT_CALL_AUTO_REJECT_MAX_MS = 22_000;
const MAX_CALL_AUTO_REJECT_DELAY_MS = 60_000;

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

function sanitizeCallerName(value: string | undefined | null) {
  const normalized = (value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return undefined;
  }
  if (/[@/\\{}<>]/.test(normalized)) {
    return undefined;
  }
  if (/^\+?\d[\d\s().-]{5,}$/.test(normalized)) {
    return undefined;
  }
  return normalized.slice(0, 40).trim() || undefined;
}

function prefixWithCallerName(message: string, callerName: string) {
  const lower = message.toLowerCase();
  if (lower.startsWith(`hey ${callerName.toLowerCase()}`) || lower.startsWith(`hi ${callerName.toLowerCase()}`)) {
    return message;
  }
  return `Hey ${callerName}, ${message}`;
}

function hasCallerToken(message: string) {
  CALL_FALLBACK_CALLER_TOKEN_PATTERN.lastIndex = 0;
  return CALL_FALLBACK_CALLER_TOKEN_PATTERN.test(message);
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

export function buildCallFallbackText(args: {
  variants: string[];
  seed: string;
  callerName?: string | null;
}) {
  const selected = selectCallFallbackVariant({
    variants: args.variants,
    seed: args.seed,
  });
  if (!selected) {
    return "";
  }

  const callerName = sanitizeCallerName(args.callerName);
  if (!callerName) {
    return selected.replace(CALL_FALLBACK_CALLER_TOKEN_PATTERN, "").replace(/\s+/g, " ").trim();
  }

  if (hasCallerToken(selected)) {
    CALL_FALLBACK_CALLER_TOKEN_PATTERN.lastIndex = 0;
    return selected.replace(CALL_FALLBACK_CALLER_TOKEN_PATTERN, callerName).replace(/\s+/g, " ").trim();
  }

  return prefixWithCallerName(selected, callerName);
}

export function resolveCallAutoRejectDelayMs(args: {
  seed: string;
  minMs?: number;
  maxMs?: number;
}) {
  const rawMin = Number.isFinite(args.minMs) ? (args.minMs as number) : DEFAULT_CALL_AUTO_REJECT_MIN_MS;
  const rawMax = Number.isFinite(args.maxMs) ? (args.maxMs as number) : DEFAULT_CALL_AUTO_REJECT_MAX_MS;
  const minMs = Math.round(Math.max(0, Math.min(rawMin, MAX_CALL_AUTO_REJECT_DELAY_MS)));
  const maxMs = Math.round(Math.max(minMs, Math.min(rawMax, MAX_CALL_AUTO_REJECT_DELAY_MS)));
  if (maxMs <= minMs) {
    return minMs;
  }
  return minMs + (stableHash(args.seed) % (maxMs - minMs + 1));
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

export function shouldCancelPendingCallAutoReject(
  snapshot: CallFallbackSessionSnapshot | null | undefined,
) {
  if (!snapshot) {
    return false;
  }
  if (shouldSuppressCallFallbackAfterOffer(snapshot)) {
    return true;
  }
  const status = (snapshot.lastStatus || "").trim().toLowerCase();
  return status === "timeout" || status === "reject" || status === "terminate";
}

export function shouldSkipStaleCallOffer(args: {
  offerAtMs: number;
  nowMs?: number;
  recencyWindowMs: number;
}) {
  const nowMs = Number.isFinite(args.nowMs) ? (args.nowMs as number) : Date.now();
  const recencyWindowMs = Math.round(Math.max(30_000, args.recencyWindowMs));
  return args.offerAtMs + recencyWindowMs < nowMs;
}
