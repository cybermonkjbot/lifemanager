import assert from "node:assert/strict";
import test from "node:test";
import {
  hasSufficientContactMemoryForAmbientSkip,
  inferAmbientContactFacts,
  judgeFactCandidate,
  planToolRouterSteps,
  selectActiveFactsForUse,
  toolRouterPlan,
} from "./chatTools";

type ToolRouterHandler = (
  ctx: {
    runQuery: (ref: unknown, args: Record<string, unknown>) => Promise<unknown>;
    runAction: (ref: unknown, args: Record<string, unknown>) => Promise<unknown>;
    runMutation: (ref: unknown, args: Record<string, unknown>) => Promise<unknown>;
  },
  args: Record<string, unknown>,
) => Promise<{
  executed?: boolean;
  outputs: Array<{ tool: string; status: string; errorCode?: string }>;
}>;

test("planToolRouterSteps keeps deterministic precedence when plannerMode is deterministic", () => {
  const plan = planToolRouterSteps({
    task: "Did we discuss this before?",
    candidateReply: "sure",
    threadIdProvided: true,
    plannerMode: "deterministic",
    modelHints: ["external_search.web"],
    includeExtraction: false,
    maxToolsPerRun: 6,
  });

  const tools = plan.steps.map((step) => step.tool);
  assert.deepEqual(tools.slice(0, 2), ["conversation_recall.query", "memory.search"]);
  assert.ok(!tools.includes("external_search.web"));
  assert.equal(plan.plannerSource, "deterministic");
});

test("planToolRouterSteps hybrid mode can add and reorder allowlisted read hints", () => {
  const plan = planToolRouterSteps({
    task: "What did we discuss before?",
    threadIdProvided: true,
    plannerMode: "hybrid",
    modelHints: ["external_search.web", "memory.search"],
    includeExtraction: false,
    maxToolsPerRun: 6,
  });

  const tools = plan.steps.map((step) => step.tool);
  assert.ok(tools.includes("conversation_recall.query"));
  assert.ok(tools.includes("external_search.web"));
  assert.ok(tools.indexOf("external_search.web") < tools.indexOf("conversation_recall.query"));
  assert.equal(plan.hintApplied, true);
});

test("planToolRouterSteps rejects unsupported hints", () => {
  const plan = planToolRouterSteps({
    task: "quick context",
    threadIdProvided: true,
    plannerMode: "hybrid",
    modelHints: ["contact_memory.extract", "unknown_tool"],
    includeExtraction: false,
    maxToolsPerRun: 4,
  });

  const tools = plan.steps.map((step) => step.tool);
  assert.deepEqual(tools, ["memory.search"]);
});

test("planToolRouterSteps ignores scope-requiring hints when thread scope is missing", () => {
  const plan = planToolRouterSteps({
    task: "quick context",
    threadIdProvided: false,
    plannerMode: "hybrid",
    modelHints: ["memory.search", "personal_connectors.search", "external_search.web"],
    includeExtraction: false,
    maxToolsPerRun: 4,
  });

  const tools = plan.steps.map((step) => step.tool);
  assert.ok(!tools.includes("memory.search"));
  assert.ok(!tools.includes("personal_connectors.search"));
  assert.ok(tools.includes("external_search.web"));
});

test("toolRouterPlan executes read-only steps in parallel", async () => {
  const handler = (toolRouterPlan as unknown as { _handler: ToolRouterHandler })._handler;
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const ctx = {
    runQuery: async () => {
      await delay(80);
      return { ok: true };
    },
    runAction: async () => {
      await delay(80);
      return { ok: true };
    },
    runMutation: async () => {
      throw new Error("runMutation should not be called in this test");
    },
  };

  const startedAt = Date.now();
  const result = await handler(ctx, {
    task: "before latest web update",
    execute: true,
    plannerMode: "deterministic",
    allowSideEffects: false,
    timeoutMs: 500,
    maxToolsPerRun: 6,
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.executed, true);
  assert.ok(Array.isArray(result.outputs));
  assert.ok(elapsedMs < 180, `expected parallel execution under 180ms, got ${elapsedMs}ms`);
});

test("toolRouterPlan gates side effects when disabled", async () => {
  const handler = (toolRouterPlan as unknown as { _handler: ToolRouterHandler })._handler;
  let mutationCalls = 0;

  const ctx = {
    runQuery: async () => ({ facts: [] }),
    runAction: async () => ({ ok: true }),
    runMutation: async () => {
      mutationCalls += 1;
      return { ok: true };
    },
  };

  const result = await handler(ctx, {
    task: "show profile fact",
    threadId: "thd_123",
    includeExtraction: true,
    execute: true,
    allowSideEffects: false,
    timeoutMs: 500,
  });

  const extractStep = result.outputs.find((step) => step.tool === "contact_memory.extract");
  assert.equal(mutationCalls, 0);
  assert.ok(extractStep);
  assert.equal(extractStep.status, "skipped");
});

test("toolRouterPlan marks timed out steps with timeout status", async () => {
  const handler = (toolRouterPlan as unknown as { _handler: ToolRouterHandler })._handler;

  const ctx = {
    runQuery: async () => await new Promise(() => {}),
    runAction: async () => await new Promise(() => {}),
    runMutation: async () => ({ ok: true }),
  };

  const result = await handler(ctx, {
    task: "quick context",
    execute: true,
    plannerMode: "deterministic",
    timeoutMs: 40,
    maxToolsPerRun: 1,
  });

  assert.equal(result.outputs[0].status, "timeout");
  assert.equal(result.outputs[0].errorCode, "timeout");
});

test("toolRouterPlan skips connector search when no scope is provided", async () => {
  const handler = (toolRouterPlan as unknown as { _handler: ToolRouterHandler })._handler;

  const ctx = {
    runQuery: async () => ({ ok: true }),
    runAction: async () => ({ ok: true }),
    runMutation: async () => ({ ok: true }),
  };

  const result = await handler(ctx, {
    task: "search personal notes and docs",
    execute: true,
    plannerMode: "hybrid",
    modelHints: ["personal_connectors.search"],
    maxToolsPerRun: 4,
    timeoutMs: 500,
  });

  const connectorStep = result.outputs.find((step) => step.tool === "personal_connectors.search");
  if (connectorStep) {
    assert.equal(connectorStep.status, "skipped");
  } else {
    const tools = result.outputs.map((step) => step.tool);
    assert.ok(!tools.includes("personal_connectors.search"));
  }
});

test("judgeFactCandidate quarantines likely sarcasm and accepts stable statements", () => {
  const sarcasm = judgeFactCandidate({
    text: "Yeah sure I love traffic lol",
    factType: "preference",
    factKey: "preference_traffic",
    factValue: "traffic",
  });
  assert.equal(sarcasm.decision, "quarantine");

  const stable = judgeFactCandidate({
    text: "I live in Abuja",
    factType: "profile",
    factKey: "profile_location",
    factValue: "Abuja",
  });
  assert.equal(stable.decision, "accept");
});

test("selectActiveFactsForUse drops stale schedule facts and keeps newest location fact", () => {
  const now = Date.now();
  const selected = selectActiveFactsForUse({
    nowMs: now,
    rows: [
      {
        _id: "a" as never,
        _creationTime: now - 1,
        threadId: "t" as never,
        factKey: "profile_location",
        factValue: "Abuja",
        factType: "profile",
        confidence: 0.8,
        createdAt: now - 40 * 24 * 60 * 60 * 1000,
        updatedAt: now - 40 * 24 * 60 * 60 * 1000,
      },
      {
        _id: "b" as never,
        _creationTime: now - 1,
        threadId: "t" as never,
        factKey: "profile_location",
        factValue: "Lagos",
        factType: "profile",
        confidence: 0.9,
        createdAt: now - 2 * 24 * 60 * 60 * 1000,
        updatedAt: now - 2 * 24 * 60 * 60 * 1000,
      },
      {
        _id: "c" as never,
        _creationTime: now - 1,
        threadId: "t" as never,
        factKey: "schedule_tuesday_evening",
        factValue: "Tuesday evening",
        factType: "schedule",
        confidence: 0.8,
        createdAt: now - 30 * 24 * 60 * 60 * 1000,
        updatedAt: now - 30 * 24 * 60 * 60 * 1000,
      },
    ],
  });

  assert.equal(selected.some((fact) => fact.factType === "schedule"), false);
  assert.equal(selected.some((fact) => fact.factKey === "profile_location" && fact.factValue === "Lagos"), true);
});

test("selectActiveFactsForUse ignores superseded and expired rows", () => {
  const now = Date.now();
  const selected = selectActiveFactsForUse({
    nowMs: now,
    rows: [
      {
        _id: "a" as never,
        _creationTime: now - 1,
        threadId: "t" as never,
        factKey: "profile_location",
        factValue: "Abuja",
        factType: "profile",
        confidence: 0.9,
        factStatus: "superseded",
        createdAt: now - 1000,
        updatedAt: now - 1000,
      } as never,
      {
        _id: "b" as never,
        _creationTime: now - 1,
        threadId: "t" as never,
        factKey: "profile_location",
        factValue: "Lagos",
        factType: "profile",
        confidence: 0.9,
        factStatus: "active",
        expiresAt: now - 1000,
        createdAt: now - 1000,
        updatedAt: now - 1000,
      } as never,
      {
        _id: "c" as never,
        _creationTime: now - 1,
        threadId: "t" as never,
        factKey: "profile_location",
        factValue: "Port Harcourt",
        factType: "profile",
        confidence: 0.9,
        factStatus: "active",
        createdAt: now - 1000,
        updatedAt: now - 1000,
      } as never,
    ],
  });

  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.factValue, "Port Harcourt");
});

test("inferAmbientContactFacts learns soft status and sticker signals without sensitive claims", () => {
  const now = Date.now();
  const stickerAssetId = "asset_sticker" as never;
  const facts = inferAmbientContactFacts({
    messages: [
      {
        _id: "msg_1" as never,
        text: "This meme is too funny 😂",
        messageType: "text",
        isStatus: true,
        messageAt: now,
      },
      {
        _id: "msg_2" as never,
        text: "At church today, prayer changes everything",
        messageType: "text",
        isStatus: true,
        messageAt: now,
      },
      {
        _id: "msg_3" as never,
        text: "[Sticker]",
        messageType: "sticker",
        mediaAssetId: stickerAssetId,
        isStatus: false,
        messageAt: now,
      },
    ],
    assetsById: new Map([
      [
        stickerAssetId,
        {
          _id: stickerAssetId,
          kind: "sticker",
          tags: ["sticker"],
          contextTags: ["playful"],
          contextSummary: "Use for funny banter.",
          contextConfidence: 0.8,
          contextSource: "vision_ai",
        },
      ],
    ]),
  });

  assert.equal(facts.some((fact) => fact.key === "profile_status_humor_style"), true);
  assert.equal(facts.some((fact) => fact.key === "preference_sticker_tone_playful"), true);
  assert.equal(facts.some((fact) => /church|prayer/i.test(fact.value)), false);
});

test("hasSufficientContactMemoryForAmbientSkip gates ambient inference when memory is already rich", () => {
  const now = Date.now();
  const rows = Array.from({ length: 10 }, (_, index) => ({
    _id: `fact_${index}` as never,
    _creationTime: now - index,
    threadId: "thread_1" as never,
    factKey: `preference_item_${index}`,
    factValue: `Useful preference ${index}`,
    factType: "preference" as const,
    confidence: 0.7,
    factStatus: "active" as const,
    createdAt: now - index,
    updatedAt: now - index,
  }));

  assert.equal(hasSufficientContactMemoryForAmbientSkip({ rows, nowMs: now }), true);
  assert.equal(hasSufficientContactMemoryForAmbientSkip({ rows: rows.slice(0, 4), nowMs: now }), false);
});
