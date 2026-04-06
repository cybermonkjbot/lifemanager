import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_MODEL_VERSION = "all-MiniLM-L6-v2";
let extractorPromise: Promise<(input: string[] | string, options: Record<string, unknown>) => Promise<unknown>> | null = null;
let initFailure: string | null = null;

function isLocalEmbeddingsEnabled() {
  const value = (process.env.SLM_EMBEDDINGS_LOCAL_ENABLED || "true").trim().toLowerCase();
  return value !== "false" && value !== "0" && value !== "off";
}

export function embeddingModelVersion() {
  return (process.env.SLM_EMBEDDINGS_MODEL || DEFAULT_MODEL_VERSION).trim() || DEFAULT_MODEL_VERSION;
}

export function embeddingContentHash(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function normalizeVector(values: number[]) {
  let norm = 0;
  for (const value of values) {
    norm += value * value;
  }
  const divisor = Math.sqrt(norm) || 1;
  return values.map((value) => value / divisor);
}

function tensorToVectors(tensorLike: unknown) {
  if (!tensorLike || typeof tensorLike !== "object") {
    return [] as number[][];
  }
  const container = tensorLike as { data?: ArrayLike<number>; dims?: number[] };
  const dims = Array.isArray(container.dims) ? container.dims : [];
  const raw = container.data ? Array.from(container.data) : [];
  if (raw.length === 0) {
    return [];
  }
  if (dims.length >= 2) {
    const width = dims[dims.length - 1] || raw.length;
    const rows = Math.max(1, Math.floor(raw.length / Math.max(1, width)));
    const vectors: number[][] = [];
    for (let row = 0; row < rows; row += 1) {
      const start = row * width;
      const slice = raw.slice(start, start + width);
      if (slice.length > 0) {
        vectors.push(normalizeVector(slice));
      }
    }
    return vectors;
  }
  return [normalizeVector(raw)];
}

async function getExtractor() {
  if (!isLocalEmbeddingsEnabled()) {
    throw new Error("Local embeddings are disabled.");
  }
  if (initFailure) {
    throw new Error(initFailure);
  }
  if (extractorPromise) {
    return extractorPromise;
  }

  extractorPromise = (async () => {
    const model = (process.env.SLM_EMBEDDINGS_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    const cacheDir = process.env.SLM_EMBEDDINGS_CACHE_DIR || join(homedir(), ".cache", "slm", "transformers");
    await mkdir(cacheDir, { recursive: true });

    const transformers = await import("@xenova/transformers");
    const env = (transformers as unknown as { env?: Record<string, unknown> }).env;
    if (env) {
      env.cacheDir = cacheDir;
      env.allowRemoteModels = true;
      env.allowLocalModels = true;
      env.useBrowserCache = false;
    }
    return await (transformers as unknown as { pipeline: Function }).pipeline("feature-extraction", model, {
      quantized: true,
    });
  })().catch((error) => {
    initFailure = error instanceof Error ? error.message : String(error);
    throw error;
  });

  return extractorPromise;
}

export async function embedTexts(texts: string[]) {
  const cleaned = texts.map((text) => text.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return {
      vectors: [] as number[][],
      modelVersion: embeddingModelVersion(),
      degraded: false,
      reason: "",
    };
  }

  try {
    const extractor = await getExtractor();
    const output = await extractor(cleaned, {
      pooling: "mean",
      normalize: true,
    });
    const vectors = tensorToVectors(output);
    if (vectors.length === cleaned.length) {
      return {
        vectors,
        modelVersion: embeddingModelVersion(),
        degraded: false,
        reason: "",
      };
    }
    return {
      vectors: [],
      modelVersion: embeddingModelVersion(),
      degraded: true,
      reason: "Embedding output shape mismatch.",
    };
  } catch (error) {
    return {
      vectors: [],
      modelVersion: embeddingModelVersion(),
      degraded: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function cosineSimilarity(a: number[], b: number[]) {
  const limit = Math.min(a.length, b.length);
  if (limit === 0) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < limit; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA <= 0 || normB <= 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
