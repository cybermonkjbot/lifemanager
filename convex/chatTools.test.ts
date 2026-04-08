import assert from "node:assert/strict";
import test from "node:test";
import { planToolRouterSteps, toolRouterPlan } from "./chatTools";

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
    runAction: async () => ({ ok: true }),
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
