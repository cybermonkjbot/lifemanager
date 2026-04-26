import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeterministicRepairReply,
  decideRelationshipPolicy,
  deriveRelationshipState,
} from "./relationship-policy";

test("deriveRelationshipState flags conflict and repair need on accusation", () => {
  const state = deriveRelationshipState({
    inboundText: "You ignored me and left me on read, why?",
    historyLines: ["Them: You disappeared yesterday", "Me: I was busy", "Them: This keeps happening"],
  });

  assert.equal(state.conflictFlag, true);
  assert.equal(state.repairNeeded, true);
  assert.ok(state.trustScore < 0.62);
  assert.equal(state.warmthTrend, -1);
});

test("deriveRelationshipState catches broader hurt and ghosting language", () => {
  for (const inboundText of ["you ghosted me and you don't care", "that was cold, I felt ignored", "you made me feel stupid"]) {
    const state = deriveRelationshipState({
      inboundText,
      historyLines: [],
    });

    assert.equal(state.conflictFlag, true, inboundText);
    assert.equal(state.repairNeeded, true, inboundText);
  }
});

test("decideRelationshipPolicy forces deterministic repair on passive-aggressive cue", () => {
  const policy = decideRelationshipPolicy({
    inboundText: "No worry, enjoy.",
    historyLines: ["Them: Okay"],
  });

  assert.equal(policy.forceDeterministicRepair, true);
  assert.equal(policy.allowHumor, false);
  assert.equal(policy.reason, "relationship_conflict_repair");
});

test("decideRelationshipPolicy catches softer passive-aggressive variants", () => {
  for (const inboundText of ["that's fine then", "forget it", "no stress, do your thing"]) {
    const policy = decideRelationshipPolicy({
      inboundText,
      historyLines: [],
    });

    assert.equal(policy.forceDeterministicRepair, true, inboundText);
    assert.equal(policy.allowHumor, false, inboundText);
  }
});

test("decideRelationshipPolicy allows humor only in safe playful context", () => {
  const policy = decideRelationshipPolicy({
    inboundText: "lol you are funny though",
    historyLines: ["Them: I appreciate you", "Me: same here"],
  });

  assert.equal(policy.forceDeterministicRepair, false);
  assert.equal(policy.allowHumor, true);
});

test("buildDeterministicRepairReply produces accountability-first response", () => {
  const state = deriveRelationshipState({
    inboundText: "You were seen at Terminus, why didn't you pick?",
    historyLines: ["Them: Why are you dodging me?"],
  });
  const reply = buildDeterministicRepairReply({
    inboundText: "You were seen at Terminus, why didn't you pick?",
    state,
  });

  assert.match(reply, /I hear you/i);
  assert.match(reply, /upset|answer directly/i);
});

test("romantic profile prioritizes romantic care and repair reasoning", () => {
  const policy = decideRelationshipPolicy({
    inboundText: "You ignored me and that hurt me",
    historyLines: ["Them: babe this is not okay"],
    profileSlug: "relationship",
  });

  assert.equal(policy.prioritizeRomanticCare, true);
  assert.equal(policy.forceDeterministicRepair, true);
  assert.equal(policy.reason, "romantic_conflict_repair");

  const reply = buildDeterministicRepairReply({
    inboundText: "You ignored me and that hurt me",
    state: policy.state,
    prioritizeRomanticCare: policy.prioritizeRomanticCare,
  });
  assert.match(reply, /I care about us/i);
});

test("romantic repair validates feelings before explaining logic", () => {
  const policy = decideRelationshipPolicy({
    inboundText: "You are always explaining and you do not get it",
    historyLines: ["Them: babe I am tired of arguing"],
    profileSlug: "relationship",
  });

  assert.equal(policy.prioritizeRomanticCare, true);
  assert.equal(policy.emotionFirstRepair, true);
  assert.equal(policy.forceDeterministicRepair, true);

  const reply = buildDeterministicRepairReply({
    inboundText: "You are always explaining and you do not get it",
    state: policy.state,
    prioritizeRomanticCare: policy.prioritizeRomanticCare,
  });

  assert.match(reply, /I care about us/i);
  assert.match(reply, /explaining first|not listening|understand you/i);
  assert.doesNotMatch(reply, /\byou should understand\b|\bmake you understand\b|\blogically\b/i);
});
