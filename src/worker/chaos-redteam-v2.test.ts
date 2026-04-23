import assert from "node:assert/strict";
import test from "node:test";
import { planToolRouterSteps, toolRouterPlan } from "../../convex/chatTools";
import { estimateDelayAndTyping } from "./ai";
import { parseInboundMessage } from "./whatsapp";
import { needsTextReplyInStickerMode } from "./sticker-thread-mode";

type ToolRouterHandler = (
  ctx: {
    runQuery: (ref: unknown, args: Record<string, unknown>) => Promise<unknown>;
    runAction: (ref: unknown, args: Record<string, unknown>) => Promise<unknown>;
    runMutation: (ref: unknown, args: Record<string, unknown>) => Promise<unknown>;
  },
  args: Record<string, unknown>,
) => Promise<{
  outputs: Array<{ tool: string; status: string; output?: unknown }>;
}>;

test("v2: unscoped recall task falls back to web search", () => {
  const plan = planToolRouterSteps({
    task: "did we discuss this before",
    candidateReply: "",
    threadIdProvided: false,
    plannerMode: "deterministic",
    includeExtraction: false,
    maxToolsPerRun: 5,
  });
  assert.deepEqual(plan.steps.map((s) => s.tool), ["external_search.web"]);
});

test("v2: scoped recall task keeps recall+memory", () => {
  const plan = planToolRouterSteps({
    task: "did we discuss this before",
    candidateReply: "",
    threadIdProvided: true,
    plannerMode: "deterministic",
    includeExtraction: false,
    maxToolsPerRun: 5,
  });
  const tools = plan.steps.map((s) => s.tool);
  assert.ok(tools.includes("conversation_recall.query"));
  assert.ok(tools.includes("memory.search"));
});

test("v2: hybrid hints cannot inject scoped tools when unscoped", () => {
  const plan = planToolRouterSteps({
    task: "quick",
    candidateReply: "",
    threadIdProvided: false,
    plannerMode: "hybrid",
    modelHints: ["memory.search", "personal_connectors.search", "thread_style.profile", "external_search.web"],
    includeExtraction: false,
    maxToolsPerRun: 8,
  });
  const tools = plan.steps.map((s) => s.tool);
  assert.ok(!tools.includes("memory.search"));
  assert.ok(!tools.includes("personal_connectors.search"));
  assert.ok(!tools.includes("thread_style.profile"));
  assert.ok(tools.includes("external_search.web"));
});

test("v2: execution skips connector step without scope", async () => {
  const handler = (toolRouterPlan as unknown as { _handler: ToolRouterHandler })._handler;
  const result = await handler(
    {
      runQuery: async () => ({ ok: true }),
      runAction: async () => ({ ok: true }),
      runMutation: async () => ({ ok: true }),
    },
    {
      task: "search personal docs",
      execute: true,
      plannerMode: "hybrid",
      modelHints: ["personal_connectors.search"],
      maxToolsPerRun: 4,
      timeoutMs: 1000,
    },
  );
  const step = result.outputs.find((o) => o.tool === "personal_connectors.search");
  if (step) {
    assert.equal(step.status, "skipped");
  } else {
    assert.ok(true);
  }
});

test("v2: delay increases with long silence gap", () => {
  const base = estimateDelayAndTyping("Seen.", {
    delayMinMs: 1200,
    delayMaxMs: 2200,
    typingMinMs: 900,
    typingMaxMs: 1800,
  });
  const withGap = estimateDelayAndTyping("Seen.", {
    delayMinMs: 1200,
    delayMaxMs: 2200,
    typingMinMs: 900,
    typingMaxMs: 1800,
    silenceGapMinutes: 240,
  });
  assert.ok(withGap.delayMs > base.delayMs);
  assert.ok(withGap.typingMs > base.typingMs);
});

test("v2: delay increases with network friction hint", () => {
  const base = estimateDelayAndTyping("Seen.", {
    delayMinMs: 1200,
    delayMaxMs: 2200,
    typingMinMs: 900,
    typingMaxMs: 1800,
  });
  const withFriction = estimateDelayAndTyping("Seen.", {
    delayMinMs: 1200,
    delayMaxMs: 2200,
    typingMinMs: 900,
    typingMaxMs: 1800,
    networkFrictionHint: true,
  });
  assert.ok(withFriction.delayMs > base.delayMs);
  assert.ok(withFriction.typingMs > base.typingMs);
});

test("v2: view-once video carries provenance", () => {
  const parsed = parseInboundMessage({
    viewOnceMessageV2: {
      message: {
        videoMessage: {
          caption: "watch this",
          mimetype: "video/mp4",
        },
      },
    },
  } as never);

  assert.equal(parsed.kind, "video");
  assert.equal((parsed as { isViewOnce?: boolean }).isViewOnce, true);
});

test("v2: passive-aggressive text forces text reply in sticker mode", () => {
  const shouldReply = needsTextReplyInStickerMode({
    inboundText: "No wahala, continue.",
    inboundKind: "sticker",
  });
  assert.equal(shouldReply, true);
});
