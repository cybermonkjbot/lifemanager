import type { ConvexHttpClient } from "convex/browser";
import type { Id } from "../../convex/_generated/dataModel";
import { convexRefs } from "../lib/convex-refs";
import { cosineSimilarity, embedTexts, embeddingContentHash, embeddingModelVersion } from "./local-embeddings";

type ThreadMessageSnapshot = {
  direction: "inbound" | "outbound";
  text: string;
  whatsappMessageId?: string;
  senderJid?: string;
  messageAt?: number;
};

type LexicalHit = {
  messageId: string;
  direction: "inbound" | "outbound";
  text: string;
  snippet: string;
  messageAt: number;
  origin?: "live" | "history_sync" | "history_fetch";
  lexicalScore?: number;
  score?: number;
  retrievalStage?: "lexical";
};

type SearchResult = {
  hits: LexicalHit[];
  candidateCount: number;
  retrievalStage: "lexical";
};

type EmbeddingRow = {
  messageId: string;
  modelVersion: string;
  contentHash: string;
  vector: number[];
};

type HistoryFetchState = {
  roundsUsed: number;
  lastFetchedAt: number;
  blockedUntil: number;
};

type HistoryFetchConfig = {
  enabled: boolean;
  maxBatch: number;
  maxRounds: number;
};

type WasocketLike = {
  fetchMessageHistory?: (count: number, oldestMsgKey: { remoteJid?: string; id?: string; fromMe?: boolean; participant?: string }, oldestMsgTimestamp: number) => Promise<string>;
};

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(value, max));
}

function parseBoundedNumber(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.round(Math.max(min, Math.min(parsed, max)));
}

function isGroupJid(jid: string) {
  return jid.endsWith("@g.us");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fallbackLinesFromCandidates(candidates: LexicalHit[], limit: number) {
  return candidates
    .slice(0, limit)
    .map((hit) =>
      `${hit.direction === "inbound" ? "Them" : "Me"}: ${hit.text}`
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 320),
    )
    .filter(Boolean);
}

async function runLexicalSearch(args: {
  convex: ConvexHttpClient;
  threadId: string;
  query: string;
  limit: number;
  lexicalLimit: number;
}) {
  return (await args.convex.query(convexRefs.contextConversationHistorySearch, {
    threadId: args.threadId as Id<"threads">,
    query: args.query,
    limit: args.limit,
    lexicalLimit: args.lexicalLimit,
  })) as SearchResult;
}

export async function maybeFetchOlderHistoryForThread(args: {
  socket: WasocketLike | null;
  convex: ConvexHttpClient;
  threadId: string;
  threadJid: string;
  threadMessages: ThreadMessageSnapshot[];
  stateByThread: Map<string, HistoryFetchState>;
  config: HistoryFetchConfig;
}) {
  if (!args.config.enabled || !args.socket?.fetchMessageHistory) {
    return { requested: false, reason: "disabled_or_socket_missing" };
  }

  const now = Date.now();
  const state = args.stateByThread.get(args.threadId) || {
    roundsUsed: 0,
    lastFetchedAt: 0,
    blockedUntil: 0,
  };
  if (state.roundsUsed >= args.config.maxRounds) {
    return { requested: false, reason: "max_rounds_reached" };
  }
  if (state.blockedUntil > now) {
    return { requested: false, reason: "backoff_active" };
  }
  if (now - state.lastFetchedAt < 12_000) {
    return { requested: false, reason: "cooldown_active" };
  }

  let oldest =
    args.threadMessages
      .filter((row) => row.whatsappMessageId)
      .sort((a, b) => (a.messageAt || 0) - (b.messageAt || 0))[0] || null;
  if (!oldest) {
    const fetchedOldest = (await args.convex.query(convexRefs.contextGetThreadOldestMessageForFetch, {
      threadId: args.threadId as Id<"threads">,
    })) as
      | {
          whatsappMessageId: string;
          direction: "inbound" | "outbound";
          senderJid?: string;
          messageAt: number;
        }
      | null;
    if (fetchedOldest) {
      oldest = {
        direction: fetchedOldest.direction,
        text: "",
        whatsappMessageId: fetchedOldest.whatsappMessageId,
        senderJid: fetchedOldest.senderJid,
        messageAt: fetchedOldest.messageAt,
      };
    }
  }

  if (!oldest?.whatsappMessageId || !oldest.messageAt) {
    return { requested: false, reason: "missing_oldest_anchor" };
  }

  const key = {
    remoteJid: args.threadJid,
    id: oldest.whatsappMessageId,
    fromMe: oldest.direction === "outbound",
    participant: isGroupJid(args.threadJid) ? oldest.senderJid : undefined,
  };
  try {
    await args.socket.fetchMessageHistory(args.config.maxBatch, key, Math.floor(oldest.messageAt / 1000));
    const roundsUsed = state.roundsUsed + 1;
    args.stateByThread.set(args.threadId, {
      roundsUsed,
      lastFetchedAt: now,
      blockedUntil: now + 15_000,
    });
    await sleep(1500);
    return { requested: true, reason: "ok", roundsUsed };
  } catch (error) {
    args.stateByThread.set(args.threadId, {
      roundsUsed: state.roundsUsed + 1,
      lastFetchedAt: now,
      blockedUntil: now + 60_000,
    });
    return {
      requested: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function buildHistorySearchOverride(args: {
  convex: ConvexHttpClient;
  threadId: string;
  query: string;
  limit?: number;
  fallbackHistoryLines?: string[];
}) {
  const limit = Math.round(Math.max(2, Math.min(args.limit ?? 8, 20)));
  const fallbackRecent = (args.fallbackHistoryLines || [])
    .slice(-limit)
    .map((line) => line.replace(/\s+/g, " ").trim().slice(0, 320))
    .filter(Boolean);
  try {
    const lexicalLimit = Math.round(Math.max(limit * 2, Math.min(limit * 6, 120)));
    const lexical = await runLexicalSearch({
      convex: args.convex,
      threadId: args.threadId,
      query: args.query,
      limit: lexicalLimit,
      lexicalLimit,
    });

    const lexicalCandidates = lexical.hits.slice(0, lexicalLimit);
    if (lexicalCandidates.length === 0) {
      return {
        override: {
          lines: fallbackRecent,
          candidateCount: 0,
          semanticRerankCount: 0,
          confidence: 0,
          retrievalStage: "lexical" as const,
        },
        diagnostics: {
          lexicalCandidates: 0,
          semanticRerankCount: 0,
          degraded: fallbackRecent.length > 0,
          reason: fallbackRecent.length > 0 ? "Using recent context fallback." : "",
        },
      };
    }

    const modelVersion = embeddingModelVersion();
    const candidateMessageIds = lexicalCandidates.map((item) => item.messageId as Id<"messages">);
    const existingRows = (await args.convex.query(convexRefs.contextGetMessageEmbeddings, {
      messageIds: candidateMessageIds,
      modelVersion,
    })) as EmbeddingRow[];
    const existingByMessage = new Map(existingRows.map((row) => [row.messageId, row]));
    const missing = lexicalCandidates.filter((item) => !existingByMessage.has(item.messageId));

    const queryEmbedding = await embedTexts([args.query]);
    const missingEmbeddings = missing.length > 0 ? await embedTexts(missing.map((item) => item.text || item.snippet || "")) : null;

    if (missingEmbeddings && !missingEmbeddings.degraded && missingEmbeddings.vectors.length === missing.length) {
      const entries = missing.map((item, index) => ({
        threadId: args.threadId as Id<"threads">,
        messageId: item.messageId as Id<"messages">,
        modelVersion,
        contentHash: embeddingContentHash(item.text || ""),
        vector: missingEmbeddings.vectors[index] || [],
      }));
      if (entries.length > 0) {
        await args.convex.mutation(convexRefs.contextUpsertMessageEmbeddings, {
          entries,
        });
        for (let index = 0; index < entries.length; index += 1) {
          const entry = entries[index];
          existingByMessage.set(entry.messageId, {
            messageId: entry.messageId,
            modelVersion: entry.modelVersion,
            contentHash: entry.contentHash,
            vector: entry.vector,
          });
        }
      }
    }

    const canSemanticRerank =
      !queryEmbedding.degraded &&
      queryEmbedding.vectors.length === 1 &&
      lexicalCandidates.some((item) => (existingByMessage.get(item.messageId)?.vector || []).length > 0);

    if (!canSemanticRerank) {
      const lines = fallbackLinesFromCandidates(lexicalCandidates, limit);
      const confidence = clamp((lexicalCandidates[0]?.score || lexicalCandidates[0]?.lexicalScore || 0), 0, 1);
      return {
        override: {
          lines,
          candidateCount: lexical.candidateCount,
          semanticRerankCount: 0,
          confidence,
          retrievalStage: "semantic_fallback" as const,
        },
        diagnostics: {
          lexicalCandidates: lexicalCandidates.length,
          semanticRerankCount: 0,
          degraded: true,
          reason: queryEmbedding.degraded ? queryEmbedding.reason : missingEmbeddings?.reason || "No semantic vectors available.",
        },
      };
    }

    const queryVector = queryEmbedding.vectors[0] || [];
    const reranked = lexicalCandidates
      .map((item) => {
        const row = existingByMessage.get(item.messageId);
        const semantic = row?.vector?.length ? clamp((cosineSimilarity(queryVector, row.vector) + 1) / 2, 0, 1) : 0;
        const lexicalScore = clamp(item.lexicalScore ?? item.score ?? 0, 0, 1);
        const combined = lexicalScore * 0.45 + semantic * 0.55;
        return {
          item,
          semantic,
          lexicalScore,
          combined,
        };
      })
      .sort((a, b) => b.combined - a.combined || b.item.messageAt - a.item.messageAt)
      .slice(0, limit);

    const lines = reranked.map((row) =>
      `${row.item.direction === "inbound" ? "Them" : "Me"}: ${row.item.text}`
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 320),
    );
    const confidence = clamp(reranked[0]?.combined || 0, 0, 1);

    return {
      override: {
        lines,
        candidateCount: lexical.candidateCount,
        semanticRerankCount: reranked.length,
        confidence,
        retrievalStage: "semantic" as const,
      },
      diagnostics: {
        lexicalCandidates: lexicalCandidates.length,
        semanticRerankCount: reranked.length,
        degraded: false,
        reason: "",
      },
    };
  } catch (error) {
    return {
      override: {
        lines: fallbackRecent,
        candidateCount: 0,
        semanticRerankCount: 0,
        confidence: 0,
        retrievalStage: "semantic_fallback" as const,
      },
      diagnostics: {
        lexicalCandidates: 0,
        semanticRerankCount: 0,
        degraded: true,
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function readHistoryFetchConfigFromEnv(): HistoryFetchConfig {
  const enabled = (process.env.SLM_HISTORY_FETCH_ON_DEMAND || "true").trim().toLowerCase();
  return {
    enabled: enabled !== "false" && enabled !== "0" && enabled !== "off",
    maxBatch: parseBoundedNumber(process.env.SLM_HISTORY_FETCH_MAX_BATCH, 50, 1, 50),
    maxRounds: parseBoundedNumber(process.env.SLM_HISTORY_FETCH_MAX_ROUNDS, 3, 1, 12),
  };
}
