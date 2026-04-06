import assert from "node:assert/strict";
import test from "node:test";
import { extractAliasesFromText } from "./inbound";
import { classifyThreadKind, resolveThreadEligibility } from "./lib/threadEligibility";

test("extractAliasesFromText finds nickname patterns", () => {
  const aliases = extractAliasesFromText("Hey it's Josh, call me jay.");
  assert.deepEqual(aliases, ["Josh", "jay"]);
});

test("extractAliasesFromText ignores text without alias cues", () => {
  const aliases = extractAliasesFromText("Let's meet later today.");
  assert.deepEqual(aliases, []);
});

test("classifyThreadKind detects broadcast/system JIDs", () => {
  assert.equal(classifyThreadKind({ jid: "status@broadcast" }), "broadcast_or_system");
  assert.equal(classifyThreadKind({ jid: "12345@g.us" }), "group");
  assert.equal(classifyThreadKind({ jid: "5551999999999@s.whatsapp.net" }), "direct");
});

test("resolveThreadEligibility gives archived precedence", () => {
  const eligibility = resolveThreadEligibility({
    thread: {
      jid: "5551999999999@s.whatsapp.net",
      isIgnored: false,
      isArchived: true,
      threadKind: "direct",
    },
    ignoreGroupsByDefault: true,
    explicitIgnoreEnabled: true,
  });
  assert.deepEqual(eligibility, {
    allowed: false,
    reason: "archived",
  });
});

test("resolveThreadEligibility keeps group ignore dynamic", () => {
  const blocked = resolveThreadEligibility({
    thread: {
      jid: "12345@g.us",
      isIgnored: true,
      isArchived: false,
      threadKind: "group",
    },
    ignoreGroupsByDefault: true,
    explicitIgnoreEnabled: false,
  });
  assert.deepEqual(blocked, {
    allowed: false,
    reason: "group_ignored",
  });

  const allowed = resolveThreadEligibility({
    thread: {
      jid: "12345@g.us",
      isIgnored: true,
      isArchived: false,
      threadKind: "group",
    },
    ignoreGroupsByDefault: false,
    explicitIgnoreEnabled: false,
  });
  assert.deepEqual(allowed, {
    allowed: true,
  });
});
