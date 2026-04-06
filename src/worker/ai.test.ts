import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOutboundText } from "./ai";

test("normalizeOutboundText removes em dashes and normalizes punctuation spacing", () => {
  const input = "Hey — are you free – later…   ";
  const output = normalizeOutboundText(input);
  assert.equal(output, "Hey, are you free, later...");
});

test("normalizeOutboundText keeps line breaks while trimming", () => {
  const input = "  First line — test  \n  Second line  ";
  const output = normalizeOutboundText(input);
  assert.equal(output, "First line, test\nSecond line");
});
