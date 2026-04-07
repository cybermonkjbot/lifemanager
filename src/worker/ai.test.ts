import assert from "node:assert/strict";
import test from "node:test";
import {
  describeInboundImageWithFallback,
  detectConversationSteeringMode,
  evaluateJokeGuardrail,
  generateReplyWithFallback,
  normalizeOutboundText,
} from "./ai";
import { getDefaultPersonaPack, getPersonaPackById } from "../../convex/lib/personaPacks";

const ENV_KEYS = [
  "AZURE_AI_ENDPOINT",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_AI_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "OPENAI_API_KEY",
  "CODEX_CLI_PATH",
] as const;

function clearAiEnv() {
  const snapshot: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};
  for (const key of ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      snapshot[key] = value;
    }
    delete process.env[key];
  }
  return snapshot;
}

function restoreAiEnv(snapshot: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test("normalizeOutboundText removes em dashes and normalizes punctuation spacing", () => {
  const input = "Hey — are you free – later…   ";
  const output = normalizeOutboundText(input);
  assert.equal(output, "Hey, are you free, later...");
});

test("normalizeOutboundText keeps line breaks while trimming", () => {
  const input = "  First line — test  \n  Second line  ";
  const output = normalizeOutboundText(input);
  assert.equal(output, "First line, test\nSecond line");
});

test("evaluateJokeGuardrail blocks similar jokes already sent in chat history", () => {
  const result = evaluateJokeGuardrail("LOL I run on coffee and chaos before noon.", [
    "Them: Morning, how are you?",
    "Me: Haha I run on coffee and chaos before noon.",
  ]);
  assert.equal(result.blocked, true);
  assert.match(result.reason, /similar joke/i);
});

test("evaluateJokeGuardrail blocks cringe joke patterns", () => {
  const result = evaluateJokeGuardrail("Knock knock. Who's there? Skibidi rizz.");
  assert.equal(result.blocked, true);
  assert.match(result.reason, /cringe/i);
});

test("evaluateJokeGuardrail allows playful lines that are fresh and non-cringe", () => {
  const result = evaluateJokeGuardrail("Haha your timing is elite, that update landed right on cue.", [
    "Me: Thanks, I sent the file earlier.",
  ]);
  assert.equal(result.blocked, false);
});

test("detectConversationSteeringMode flags hard stop requests", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "Please stop texting me.",
    historyLines: [],
  });
  assert.equal(mode, "hard_stop");
});

test("detectConversationSteeringMode flags pause requests", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "I'm in a meeting right now, talk later",
    historyLines: [],
  });
  assert.equal(mode, "pause");
});

test("detectConversationSteeringMode flags wrap-up acknowledgements", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "Thanks, all good.",
    historyLines: [],
  });
  assert.equal(mode, "wrap_up");
});

test("detectConversationSteeringMode flags looping low-signal exchanges", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "ok",
    historyLines: [
      "Me: Are you free this evening?",
      "Them: ok",
      "Me: Should I lock in 7pm?",
      "Them: cool",
    ],
  });
  assert.equal(mode, "loop");
});

test("describeInboundImageWithFallback returns heuristic fallback when Azure config is missing", async () => {
  const snapshot = clearAiEnv();

  try {
    const result = await describeInboundImageWithFallback({
      imageBytes: Buffer.from("fake-image"),
      caption: "wild status",
      mimeType: "image/jpeg",
    });
    assert.equal(result.provider, "heuristic");
    assert.match(result.description, /wild status/i);
    assert.match(result.error || "", /endpoint\/key missing/i);
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback short-circuits wrap-up messages locally", async () => {
  const snapshot = clearAiEnv();

  try {
    const result = await generateReplyWithFallback({
      inboundText: "Thanks, all good.",
      historyLines: ["Me: Sent details earlier."],
      styleHints: [],
    });

    assert.equal(result.provider, "heuristic");
    assert.equal(result.model, "heuristic-local-wrap_up");
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0]?.stage, "heuristic_fallback");
    assert.equal(result.contextToolCalls, undefined);
    assert.equal(result.contextWindow, undefined);
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback emits context tool calls and searchable context stats", async () => {
  const snapshot = clearAiEnv();

  try {
    const result = await generateReplyWithFallback({
      inboundText: "Can you send that March invoice summary?",
      historyLines: [
        "Them: ok",
        "Me: sure",
        "Them: ok",
        "Me: got it",
        "Them: Can you resend the March invoice for Acme project?",
        "Me: I can send it today.",
        "Them: thanks",
        "Them: ok",
        "Me: noted",
      ],
      styleHints: [],
      runtime: {
        fallbackMode: "azure_only",
        historyLineLimit: 6,
        contextSearchLineLimit: 3,
      },
    });

    assert.equal(result.guardrailBlocked, true);
    assert.ok(Array.isArray(result.contextToolCalls));
    assert.ok(result.contextToolCalls && result.contextToolCalls.some((call) => call.name === "context_window_cleaning"));
    assert.ok(result.contextToolCalls && result.contextToolCalls.some((call) => call.name === "conversation_history_search"));
    assert.ok(result.contextToolCalls && result.contextToolCalls.some((call) => call.name === "context_window_detection"));

    const searchCall = result.contextToolCalls?.find((call) => call.name === "conversation_history_search");
    assert.ok(typeof searchCall?.output?.hits === "number");
    assert.ok((searchCall?.output?.hits as number) >= 1);

    assert.ok(result.contextWindow);
    assert.ok((result.contextWindow?.usedHistoryLines || 0) <= 6);
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback records external semantic search diagnostics when override is provided", async () => {
  const snapshot = clearAiEnv();
  try {
    const result = await generateReplyWithFallback({
      inboundText: "Need the timeline from last week",
      historyLines: [
        "Them: hi",
        "Me: hello",
        "Them: can you send timeline",
      ],
      historySearchOverride: {
        lines: ["Them: Can you send the timeline from last week?", "Me: I sent the first draft timeline on Friday."],
        candidateCount: 42,
        semanticRerankCount: 8,
        confidence: 0.73,
        retrievalStage: "semantic",
      },
      styleHints: [],
      runtime: {
        fallbackMode: "azure_only",
      },
    });

    const searchCall = result.contextToolCalls?.find((call) => call.name === "conversation_history_search");
    assert.ok(searchCall);
    assert.equal(searchCall?.input?.source, "external");
    assert.equal(searchCall?.output?.candidateCount, 42);
    assert.equal(searchCall?.output?.semanticRerankCount, 8);
    assert.equal(searchCall?.output?.retrievalStage, "semantic");
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("context window trimming keeps prompt within configured budget", async () => {
  const snapshot = clearAiEnv();
  try {
    const noisyHistory = Array.from({ length: 40 }).map((_, index) => {
      const speaker = index % 2 === 0 ? "Me" : "Them";
      return `${speaker}: ${"long context ".repeat(8)}${index}`;
    });

    const result = await generateReplyWithFallback({
      inboundText: "What did we decide about the weekly metrics dashboard?",
      historyLines: noisyHistory,
      styleHints: [],
      runtime: {
        fallbackMode: "azure_only",
        historyLineLimit: 20,
        contextSearchLineLimit: 4,
        maxContextTokens: 260,
        contextReserveTokens: 150,
      },
    });

    const detectionCalls = (result.contextToolCalls || []).filter((call) => call.name === "context_window_detection");
    assert.ok(detectionCalls.length >= 2);
    const firstOverflow = Number(detectionCalls[0]?.output?.overflowTokens || 0);
    const finalOverflow = Number(detectionCalls[detectionCalls.length - 1]?.output?.overflowTokens || 0);
    assert.ok(finalOverflow <= firstOverflow);
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("persona pack loader returns validated default pack", () => {
  const pack = getDefaultPersonaPack();
  assert.equal(pack.id, "josh_witty_shortcuts.v1");
  assert.ok(pack.fewShots.length >= 30);
  assert.deepEqual(pack.activation.allowedProfileSlugs, ["girlfriend", "relationship"]);
  assert.equal(getPersonaPackById("missing-pack"), null);
});

test("generateReplyWithFallback applies active persona pack only for romantic profile slugs", async () => {
  const snapshot = clearAiEnv();
  process.env.CODEX_CLI_PATH = "__missing_codex_binary__";
  try {
    const romantic = await generateReplyWithFallback({
      inboundText: "How was your day?",
      historyLines: ["Them: How was your day?"],
      styleHints: [],
      personality: { profileSlug: "girlfriend" },
      runtime: {
        activePersonaPackId: "josh_witty_shortcuts.v1",
        qualityGateMode: "log_only",
      },
    });
    assert.equal(romantic.activePersonaPackId, "josh_witty_shortcuts.v1");

    const casual = await generateReplyWithFallback({
      inboundText: "How was your day?",
      historyLines: ["Them: How was your day?"],
      styleHints: [],
      personality: { profileSlug: "casual" },
      runtime: {
        activePersonaPackId: "josh_witty_shortcuts.v1",
        qualityGateMode: "log_only",
      },
    });
    assert.equal(casual.activePersonaPackId, undefined);
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback runs one rewrite pass in auto_rewrite_once mode", async () => {
  const snapshot = clearAiEnv();
  process.env.CODEX_CLI_PATH = "__missing_codex_binary__";
  try {
    const baseline = await generateReplyWithFallback({
      inboundText: "Are you free tomorrow afternoon?",
      historyLines: ["Them: Are you free tomorrow afternoon?"],
      styleHints: [],
      personality: { profileSlug: "girlfriend" },
      runtime: {
        activePersonaPackId: "josh_witty_shortcuts.v1",
        qualityGateMode: "log_only",
        qualityGateThreshold: 0.99,
      },
    });
    const result = await generateReplyWithFallback({
      inboundText: "Are you free tomorrow afternoon?",
      historyLines: ["Them: Are you free tomorrow afternoon?"],
      styleHints: [],
      personality: { profileSlug: "girlfriend" },
      runtime: {
        activePersonaPackId: "josh_witty_shortcuts.v1",
        qualityGateMode: "auto_rewrite_once",
        qualityGateThreshold: 0.99,
      },
    });

    assert.ok(result.attempts.length > baseline.attempts.length);
    assert.ok(typeof result.qualityScore === "number");
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback supports manual_review and log_only quality gate modes", async () => {
  const snapshot = clearAiEnv();
  process.env.CODEX_CLI_PATH = "__missing_codex_binary__";
  try {
    const manualReview = await generateReplyWithFallback({
      inboundText: "Are you free tomorrow afternoon?",
      historyLines: ["Them: Are you free tomorrow afternoon?"],
      styleHints: [],
      personality: { profileSlug: "girlfriend" },
      runtime: {
        activePersonaPackId: "josh_witty_shortcuts.v1",
        qualityGateMode: "manual_review",
        qualityGateThreshold: 0.99,
      },
    });
    assert.equal(manualReview.guardrailBlocked, true);
    assert.match(manualReview.guardrailReason || "", /quality gate/i);

    const logOnly = await generateReplyWithFallback({
      inboundText: "Are you free tomorrow afternoon?",
      historyLines: ["Them: Are you free tomorrow afternoon?"],
      styleHints: [],
      personality: { profileSlug: "girlfriend" },
      runtime: {
        activePersonaPackId: "josh_witty_shortcuts.v1",
        qualityGateMode: "log_only",
        qualityGateThreshold: 0.99,
      },
    });
    assert.equal(logOnly.guardrailBlocked, false);
    assert.ok(typeof logOnly.qualityScore === "number");
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("high-risk guardrail overrides quality gate controls", async () => {
  const snapshot = clearAiEnv();
  process.env.CODEX_CLI_PATH = "__missing_codex_binary__";
  try {
    const result = await generateReplyWithFallback({
      inboundText: "Please send your password now.",
      historyLines: [],
      styleHints: [],
      personality: { profileSlug: "girlfriend" },
      runtime: {
        activePersonaPackId: "josh_witty_shortcuts.v1",
        qualityGateMode: "log_only",
      },
    });
    assert.equal(result.guardrailBlocked, true);
    assert.match(result.guardrailReason || "", /high-risk/i);
  } finally {
    restoreAiEnv(snapshot);
  }
});
