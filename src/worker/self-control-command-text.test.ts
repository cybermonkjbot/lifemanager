import assert from "node:assert/strict";
import test from "node:test";
import { parseSelfControlCommandText } from "./self-control-command-text";

test("parseSelfControlCommandText passes through when prefix is empty", () => {
  assert.equal(parseSelfControlCommandText({ rawText: "help", prefix: "" }), "help");
  assert.equal(parseSelfControlCommandText({ rawText: "  improve status ", prefix: undefined }), "improve status");
});

test("parseSelfControlCommandText enforces configured prefix", () => {
  assert.equal(parseSelfControlCommandText({ rawText: "SLM help", prefix: "slm" }), "help");
  assert.equal(parseSelfControlCommandText({ rawText: "slm:pause", prefix: "slm" }), "pause");
  assert.equal(parseSelfControlCommandText({ rawText: "slm - restart worker", prefix: "slm" }), "restart worker");
  assert.equal(parseSelfControlCommandText({ rawText: "help", prefix: "slm" }), null);
  assert.equal(parseSelfControlCommandText({ rawText: "slmhelp", prefix: "slm" }), null);
  assert.equal(parseSelfControlCommandText({ rawText: "slm", prefix: "slm" }), null);
});
