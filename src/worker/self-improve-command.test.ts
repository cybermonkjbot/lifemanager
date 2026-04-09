import assert from "node:assert/strict";
import test from "node:test";
import { parseSelfImproveCommand } from "./self-improve-command";

test("parseSelfImproveCommand parses run commands with prompt text", () => {
  assert.deepEqual(parseSelfImproveCommand("improve tighten runtime command confirmations"), {
    action: "run",
    prompt: "tighten runtime command confirmations",
    raw: "improve tighten runtime command confirmations",
  });
  assert.deepEqual(parseSelfImproveCommand("/slm improve: harden WhatsApp command parser"), {
    action: "run",
    prompt: "harden WhatsApp command parser",
    raw: "/slm improve: harden WhatsApp command parser",
  });
  assert.deepEqual(parseSelfImproveCommand("codex self-improve improve queue reliability"), {
    action: "run",
    prompt: "improve queue reliability",
    raw: "codex self-improve improve queue reliability",
  });
});

test("parseSelfImproveCommand parses status and latest shortcuts", () => {
  assert.deepEqual(parseSelfImproveCommand("improve status"), {
    action: "status",
    raw: "improve status",
  });
  assert.deepEqual(parseSelfImproveCommand("improve latest"), {
    action: "latest",
    raw: "improve latest",
  });
});

test("parseSelfImproveCommand rejects non-command text", () => {
  assert.equal(parseSelfImproveCommand("we should improve this soon"), null);
  assert.equal(parseSelfImproveCommand("improve"), null);
  assert.equal(parseSelfImproveCommand(""), null);
});
