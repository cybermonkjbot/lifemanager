import assert from "node:assert/strict";
import test from "node:test";
import { parseRuntimeCommand } from "./runtime-commands";

test("parseRuntimeCommand parses direct worker controls", () => {
  assert.deepEqual(parseRuntimeCommand("pause worker"), {
    action: "pause",
    target: "worker",
    raw: "pause worker",
  });
  assert.deepEqual(parseRuntimeCommand("restart worker now"), {
    action: "restart",
    target: "worker",
    raw: "restart worker now",
  });
});

test("parseRuntimeCommand parses app controls with prefix", () => {
  assert.deepEqual(parseRuntimeCommand("/slm resume app"), {
    action: "resume",
    target: "app",
    raw: "/slm resume app",
  });
});

test("parseRuntimeCommand parses both target from explicit pair", () => {
  assert.deepEqual(parseRuntimeCommand("restart worker and app"), {
    action: "restart",
    target: "both",
    raw: "restart worker and app",
  });
  assert.deepEqual(parseRuntimeCommand("pause both"), {
    action: "pause",
    target: "both",
    raw: "pause both",
  });
});

test("parseRuntimeCommand rejects ambiguous or non-command notes", () => {
  assert.equal(parseRuntimeCommand("I need to restart app tomorrow"), null);
  assert.equal(parseRuntimeCommand("resume"), null);
  assert.equal(parseRuntimeCommand("worker app"), null);
  assert.equal(parseRuntimeCommand("pause and resume worker"), null);
});
