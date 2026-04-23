import assert from "node:assert/strict";
import test from "node:test";
import { planToolRouterSteps } from "../../convex/chatTools";
import { hasPidginSignal } from "../../shared/pidgin-lexicon";
import { generateReplyWithFallback, estimateDelayAndTyping } from "./ai";
import { needsTextReplyInStickerMode } from "./sticker-thread-mode";
import { parseInboundMessage } from "./whatsapp";

type EnvSnapshot = Record<string, string | undefined>;

function snapshotEnv(keys: string[]): EnvSnapshot {
  const snapshot: EnvSnapshot = {};
  for (const key of keys) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function restoreEnv(snapshot: EnvSnapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
}

async function capturePromptBody(args: { inboundText: string; historyLines?: string[] }) {
  const envKeys = ["AZURE_AI_ENDPOINT", "AZURE_AI_API_KEY"];
  const envSnapshot = snapshotEnv(envKeys);
  const originalFetch = globalThis.fetch;
  const requestBodies: string[] = [];

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(typeof init?.body === "string" ? init.body : "");
      return new Response(JSON.stringify({ output_text: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: args.inboundText,
      historyLines: args.historyLines || [],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
    });

    assert.equal(result.provider, "azure");
    return requestBodies.join("\n");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(envSnapshot);
  }
}

test("chaos-fix: identity probe uses minimal disclosure policy", async () => {
  const body = await capturePromptBody({ inboundText: "Are you AI? Who built you?" });
  assert.match(body, /Identity disclosure protocol/i);
  assert.match(body, /disclose transparently but minimally/i);
  assert.doesNotMatch(body, /designed by Joshua/i);
});

test("chaos-fix: Jos slang Wyr/Kukuma now triggers pidgin signal", () => {
  const signal = hasPidginSignal({
    inboundText: "Wyr now? Kukuma tell me true.",
    historyLines: ["Them: You dey around?"],
  });
  assert.equal(signal, true);
});

test("chaos-fix: utility interrupt injects explicit prompt guardrail", async () => {
  const body = await capturePromptBody({
    inboundText: "Abeg fuel dey NNPC? Light don come?",
    historyLines: ["Them: we need to settle this serious issue"],
  });
  assert.match(body, /Utility-interrupt mode is ON/i);
});

test("chaos-fix: delay model supports silence and network friction hints", () => {
  const base = estimateDelayAndTyping("No worry, I just saw this now.", {
    delayMinMs: 1200,
    delayMaxMs: 3000,
    typingMinMs: 900,
    typingMaxMs: 2600,
  });
  const adjusted = estimateDelayAndTyping("No worry, I just saw this now.", {
    delayMinMs: 1200,
    delayMaxMs: 3000,
    typingMinMs: 900,
    typingMaxMs: 2600,
    silenceGapMinutes: 240,
    networkFrictionHint: true,
  });

  assert.ok(adjusted.delayMs > base.delayMs);
  assert.ok(adjusted.typingMs > base.typingMs);
});

test("chaos-fix: planner avoids memory search when thread scope is absent", () => {
  const plan = planToolRouterSteps({
    task: "quick context",
    candidateReply: "",
    threadIdProvided: false,
    plannerMode: "deterministic",
    includeExtraction: false,
    maxToolsPerRun: 4,
  });

  assert.deepEqual(plan.steps.map((s) => s.tool), ["external_search.web"]);
});

test("chaos-fix: planner blocks connector search without thread scope", () => {
  const plan = planToolRouterSteps({
    task: "search my notes and docs about this",
    candidateReply: "",
    threadIdProvided: false,
    plannerMode: "deterministic",
    includeExtraction: false,
    maxToolsPerRun: 6,
  });

  assert.ok(!plan.steps.some((step) => step.tool === "personal_connectors.search"));
});

test("chaos-fix: view-once media carries ephemeral provenance", () => {
  const parsed = parseInboundMessage({
    viewOnceMessage: {
      message: {
        imageMessage: {
          caption: "Check this",
          mimetype: "image/jpeg",
        },
      },
    },
  } as never);

  assert.equal(parsed.kind, "image");
  assert.equal(parsed.text, "[Image] Check this");
  assert.equal((parsed as { isViewOnce?: boolean }).isViewOnce, true);
});

test("chaos-fix: passive-aggressive text in sticker-mode requires text reply", () => {
  const needsText = needsTextReplyInStickerMode({
    inboundText: "No worry, enjoy.",
    inboundKind: "sticker",
  });
  assert.equal(needsText, true);
});

test("chaos-fix: passive-aggressive subtweet gets explicit prompt guardrail", async () => {
  const body = await capturePromptBody({
    inboundText: "No worry, enjoy.",
    historyLines: ["Them: You ignored me since yesterday"],
  });

  assert.match(body, /Tone-shift guardrail/i);
});

test("chaos-fix: local geography accusation gets low-claim guardrail", async () => {
  const body = await capturePromptBody({
    inboundText: "You were seen at Terminus, why didn't you pick?",
    historyLines: ["Them: answer me now"],
  });

  assert.match(body, /Local accusation guardrail/i);
});
