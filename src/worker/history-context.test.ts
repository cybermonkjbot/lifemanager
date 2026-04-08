import assert from "node:assert/strict";
import test from "node:test";
import { buildHistorySearchOverride } from "./history-context";

test("buildHistorySearchOverride falls back to recent context when lexical search throws", async () => {
  const fakeConvex = {
    query: async () => {
      throw new Error("HTTP 503 upstream unavailable");
    },
    mutation: async () => null,
  } as unknown as Parameters<typeof buildHistorySearchOverride>[0]["convex"];

  const result = await buildHistorySearchOverride({
    convex: fakeConvex,
    threadId: "thread_1",
    query: "what did we discuss",
    limit: 4,
    fallbackHistoryLines: [
      "Them: Hello there",
      "Me: Hey, what's up",
      "Them: We talked about travel docs",
      "Me: I said I'd send details",
    ],
  });

  assert.equal(result.override.retrievalStage, "semantic_fallback");
  assert.ok(result.override.lines.length > 0);
  assert.equal(result.diagnostics.degraded, true);
});

test("buildHistorySearchOverride reuses fallback lines when lexical search is empty", async () => {
  const fakeConvex = {
    query: async () => ({ hits: [], candidateCount: 0, retrievalStage: "lexical" }),
    mutation: async () => null,
  } as unknown as Parameters<typeof buildHistorySearchOverride>[0]["convex"];

  const result = await buildHistorySearchOverride({
    convex: fakeConvex,
    threadId: "thread_2",
    query: "anything",
    limit: 3,
    fallbackHistoryLines: ["Them: ping", "Me: pong"],
  });

  assert.equal(result.override.retrievalStage, "lexical");
  assert.deepEqual(result.override.lines, ["Them: ping", "Me: pong"]);
});
