import assert from "node:assert/strict";
import test from "node:test";
import { isSelfControlHelpCommand } from "./control-help-command";

test("isSelfControlHelpCommand accepts help aliases", () => {
  assert.equal(isSelfControlHelpCommand("HELP"), true);
  assert.equal(isSelfControlHelpCommand("/slm help"), true);
  assert.equal(isSelfControlHelpCommand("runtime help"), true);
  assert.equal(isSelfControlHelpCommand("improve help"), true);
  assert.equal(isSelfControlHelpCommand("codex improve help"), true);
});

test("isSelfControlHelpCommand rejects non-help text", () => {
  assert.equal(isSelfControlHelpCommand("help me improve this"), false);
  assert.equal(isSelfControlHelpCommand("improve status"), false);
  assert.equal(isSelfControlHelpCommand("pause worker"), false);
  assert.equal(isSelfControlHelpCommand(""), false);
});
