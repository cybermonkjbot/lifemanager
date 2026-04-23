import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSelfControlManagerPrompt,
  parseSelfControlManagerOutput,
  SELF_CONTROL_MANAGER_TOOL_REGISTRY,
} from "./self-control-manager";

test("parseSelfControlManagerOutput parses manager plan payload", () => {
  const parsed = parseSelfControlManagerOutput(
    '{"summary":"run outreach and show contacts","confidence":0.91,"steps":[{"tool":"threads_list_contacts","args":{"limit":12,"provider":"whatsapp"}},{"tool":"outreach_run","args":{}}]}',
  );
  assert.deepEqual(parsed, {
    summary: "run outreach and show contacts",
    confidence: 0.91,
    steps: [
      { tool: "threads_list_contacts", args: { limit: 12, provider: "whatsapp" } },
      { tool: "outreach_run", args: {} },
    ],
  });
});

test("parseSelfControlManagerOutput returns null for invalid payload", () => {
  assert.equal(parseSelfControlManagerOutput("not json"), null);
  assert.equal(parseSelfControlManagerOutput('{"steps":[]}'), null);
});

test("buildSelfControlManagerPrompt includes strict guidance and message", () => {
  const prompt = buildSelfControlManagerPrompt("run a campaign and show contacts");
  assert.equal(prompt.includes("strict JSON"), true);
  assert.equal(prompt.includes("Message: run a campaign and show contacts"), true);
  assert.equal(prompt.includes("Tools:"), true);
});

test("SELF_CONTROL_MANAGER_TOOL_REGISTRY includes core tools", () => {
  assert.equal(typeof SELF_CONTROL_MANAGER_TOOL_REGISTRY.runtime_command?.purpose, "string");
  assert.equal(typeof SELF_CONTROL_MANAGER_TOOL_REGISTRY.outreach_run?.argsShape, "string");
  assert.equal(typeof SELF_CONTROL_MANAGER_TOOL_REGISTRY.agenda_create_range?.argsShape, "string");
});
