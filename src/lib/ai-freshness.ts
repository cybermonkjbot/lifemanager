import { createHash } from "node:crypto";

type AiFreshnessCandidateFact = {
  factType?: string;
  factValue?: string;
  confidence?: number;
};

type AiFreshnessFingerprintArgs = {
  scope: "test_ai" | "gateway";
  inboundText: string;
  threadId?: string;
  historyLines?: string[];
  styleHints?: string[];
  contactFacts?: AiFreshnessCandidateFact[];
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
};

type CacheEntry<T> = {
  createdAt: number;
  expiresAt: number;
  value: T;
};

const DEFAULT_AI_FRESHNESS_TTL_MS = 90_000;
const MAX_AI_FRESHNESS_TTL_MS = 30 * 60 * 1000;
const MIN_AI_FRESHNESS_TTL_MS = 10_000;
const DEFAULT_AI_FRESHNESS_MAX_ENTRIES = 500;
const MAX_AI_FRESHNESS_ENTRIES = 2_000;

const AI_FRESHNESS_CACHE = new Map<string, CacheEntry<unknown>>();

function clamp(number: number, min: number, max: number) {
  return Math.max(min, Math.min(number, max));
}

function parseIntegerEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.round(parsed);
}

function resolveAiFreshnessTtlMs() {
  const fromEnv = parseIntegerEnv("AI_FRESHNESS_TTL_MS", DEFAULT_AI_FRESHNESS_TTL_MS);
  return clamp(fromEnv, MIN_AI_FRESHNESS_TTL_MS, MAX_AI_FRESHNESS_TTL_MS);
}

function resolveAiFreshnessMaxEntries() {
  const fromEnv = parseIntegerEnv("AI_FRESHNESS_MAX_ENTRIES", DEFAULT_AI_FRESHNESS_MAX_ENTRIES);
  return clamp(fromEnv, 50, MAX_AI_FRESHNESS_ENTRIES);
}

function normalizeText(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeLineSet(lines: string[] | undefined, maxItems: number, maxChars: number) {
  if (!lines || lines.length === 0) {
    return [];
  }
  return lines
    .slice(-maxItems)
    .map((line) => normalizeText(line).slice(0, maxChars))
    .filter(Boolean);
}

function normalizeFacts(facts: AiFreshnessCandidateFact[] | undefined) {
  if (!facts || facts.length === 0) {
    return [];
  }
  return facts
    .slice(0, 12)
    .map((fact) => ({
      factType: normalizeText(fact.factType || ""),
      factValue: normalizeText(fact.factValue || "").slice(0, 220),
      confidence: fact.confidence === undefined ? undefined : Math.round(fact.confidence * 1000) / 1000,
    }))
    .filter((fact) => fact.factValue);
}

export function buildAiFreshnessFingerprint(args: AiFreshnessFingerprintArgs) {
  const payload = {
    scope: args.scope,
    inboundText: normalizeText(args.inboundText).slice(0, 2400),
    threadId: args.threadId?.trim() || "",
    historyLines: normalizeLineSet(args.historyLines, 60, 320),
    styleHints: normalizeLineSet(args.styleHints, 30, 220),
    contactFacts: normalizeFacts(args.contactFacts),
    model: normalizeText(args.model || ""),
    temperature:
      args.temperature === undefined || !Number.isFinite(args.temperature) ? undefined : Math.round(args.temperature * 1000) / 1000,
    maxOutputTokens:
      args.maxOutputTokens === undefined || !Number.isFinite(args.maxOutputTokens) ? undefined : Math.round(args.maxOutputTokens),
  };

  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return `ai:fresh:${digest}`;
}

function pruneCache(now: number) {
  for (const [key, entry] of AI_FRESHNESS_CACHE.entries()) {
    if (entry.expiresAt <= now) {
      AI_FRESHNESS_CACHE.delete(key);
    }
  }

  const maxEntries = resolveAiFreshnessMaxEntries();
  if (AI_FRESHNESS_CACHE.size <= maxEntries) {
    return;
  }

  const overflow = AI_FRESHNESS_CACHE.size - maxEntries;
  const keys = AI_FRESHNESS_CACHE.keys();
  for (let index = 0; index < overflow; index += 1) {
    const next = keys.next();
    if (next.done) {
      break;
    }
    AI_FRESHNESS_CACHE.delete(next.value);
  }
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function getAiFreshnessCachedValue<T>(key: string, now = Date.now()): { value: T; ageMs: number } | null {
  const cached = AI_FRESHNESS_CACHE.get(key);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= now) {
    AI_FRESHNESS_CACHE.delete(key);
    return null;
  }
  return {
    value: cloneValue(cached.value as T),
    ageMs: Math.max(0, now - cached.createdAt),
  };
}

export function setAiFreshnessCachedValue<T>(key: string, value: T, now = Date.now()) {
  const ttlMs = resolveAiFreshnessTtlMs();
  AI_FRESHNESS_CACHE.set(key, {
    createdAt: now,
    expiresAt: now + ttlMs,
    value: cloneValue(value),
  });
  pruneCache(now);
}

export function clearAiFreshnessCacheForTests() {
  AI_FRESHNESS_CACHE.clear();
}
