import assert from "node:assert/strict";
import test from "node:test";
import { extractAliasesFromText } from "./inbound";

test("extractAliasesFromText finds nickname patterns", () => {
  const aliases = extractAliasesFromText("Hey it's Josh, call me jay.");
  assert.deepEqual(aliases, ["Josh", "jay"]);
});

test("extractAliasesFromText ignores text without alias cues", () => {
  const aliases = extractAliasesFromText("Let's meet later today.");
  assert.deepEqual(aliases, []);
});
