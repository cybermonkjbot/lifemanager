import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSelfControlSmartRouterPrompt,
  fallbackSelfControlSmartRoute,
  parseSelfControlSmartRouteOutput,
} from "./self-control-smart-router";

test("parseSelfControlSmartRouteOutput parses openclaw forward payloads", () => {
  const parsed = parseSelfControlSmartRouteOutput(
    '{"tool":"openclaw","action":"forward","input":"send me the file again","confidence":0.91}',
    "fallback input",
  );
  assert.deepEqual(parsed, {
    tool: "openclaw",
    action: "forward",
    input: "send me the file again",
    confidence: 0.91,
  });
});

test("parseSelfControlSmartRouteOutput parses codex improve status payloads", () => {
  const parsed = parseSelfControlSmartRouteOutput(
    'ok\n{"tool":"codex_improve","action":"status","reason":"status check"}',
    "fallback input",
  );
  assert.deepEqual(parsed, {
    tool: "codex_improve",
    action: "status",
    reason: "status check",
  });
});

test("parseSelfControlSmartRouteOutput falls back input for run/forward actions", () => {
  assert.deepEqual(parseSelfControlSmartRouteOutput('{"tool":"openclaw","action":"forward"}', "hi there"), {
    tool: "openclaw",
    action: "forward",
    input: "hi there",
  });
  assert.deepEqual(parseSelfControlSmartRouteOutput('{"tool":"codex_improve","action":"run"}', "tighten retries"), {
    tool: "codex_improve",
    action: "run",
    input: "tighten retries",
  });
});

test("fallbackSelfControlSmartRoute chooses codex improve for improve phrasing", () => {
  assert.deepEqual(fallbackSelfControlSmartRoute("improve status"), {
    tool: "codex_improve",
    action: "status",
    reason: "explicit_improve_status",
    confidence: 0.85,
  });
  assert.deepEqual(fallbackSelfControlSmartRoute("improve ensure openclaw file send works"), {
    tool: "codex_improve",
    action: "run",
    input: "improve ensure openclaw file send works",
    reason: "improve_keyword",
    confidence: 0.75,
  });
});

test("fallbackSelfControlSmartRoute prioritizes conversation operations for openclaw", () => {
  assert.deepEqual(fallbackSelfControlSmartRoute("run a reach out campaign for cold leads"), {
    tool: "openclaw",
    action: "forward",
    input: "run a reach out campaign for cold leads",
    reason: "conversation_ops_keyword",
    confidence: 0.82,
  });
  assert.deepEqual(fallbackSelfControlSmartRoute("start a new conversation with my old clients"), {
    tool: "openclaw",
    action: "forward",
    input: "start a new conversation with my old clients",
    reason: "conversation_ops_keyword",
    confidence: 0.82,
  });
});

test("fallbackSelfControlSmartRoute defaults to openclaw forward", () => {
  assert.deepEqual(fallbackSelfControlSmartRoute("Can you find public blogs and write positive posts?"), {
    tool: "openclaw",
    action: "forward",
    input: "Can you find public blogs and write positive posts?",
    reason: "default_openclaw",
    confidence: 0.65,
  });
});

test("buildSelfControlSmartRouterPrompt includes message payload", () => {
  const prompt = buildSelfControlSmartRouterPrompt("send the file again");
  assert.equal(prompt.includes("Message: send the file again"), true);
  assert.equal(prompt.includes("strict JSON"), true);
  assert.equal(prompt.includes("conversation operations"), true);
});
