import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPidginReplyInstruction,
  classifyPidginCandidateTerm,
  computePidginSignalScore,
  detectPidginContext,
  hasPidginCasualSignal,
  hasPidginRecallCue,
  hasPidginSignal,
  hasPidginStyleCue,
  normalizePidginFamilyTerms,
} from "./pidgin-lexicon";

test("computePidginSignalScore scores clear pidgin phrasing above threshold", () => {
  const score = computePidginSignalScore("abeg no vex, how far? i dey road");
  assert.ok(score >= 1.2);
});

test("hasPidginSignal uses history context", () => {
  const signal = hasPidginSignal({
    inboundText: "See you later",
    historyLines: ["Them: no wahala", "Me: I go yarn you later"],
  });
  assert.equal(signal, true);
});

test("hasPidginSignal stays false for plain English", () => {
  const signal = hasPidginSignal({
    inboundText: "Can we continue this tomorrow morning?",
    historyLines: ["Them: Thanks for the update", "Me: Sure, will do."],
  });
  assert.equal(signal, false);
});

test("hasPidginSignal catches newly curated Naija lexicon terms", () => {
  const signal = hasPidginSignal({
    inboundText: "oshey, you dey shakara too much",
  });
  assert.equal(signal, true);
});

test("hasPidginCasualSignal detects naija casual terms", () => {
  assert.equal(hasPidginCasualSignal("how far, wetin dey sup?"), true);
  assert.equal(hasPidginCasualSignal("Could you please send the deck?"), false);
});

test("hasPidginRecallCue detects pidgin recall prompts", () => {
  assert.equal(hasPidginRecallCue("you don send am?"), true);
  assert.equal(hasPidginRecallCue("abeg remind me later"), true);
  assert.equal(hasPidginRecallCue("Can we schedule for Thursday?"), false);
});

test("hasPidginStyleCue catches direct style asks and slang cues", () => {
  assert.equal(hasPidginStyleCue("switch to pidgin"), true);
  assert.equal(hasPidginStyleCue("use naija slang please"), true);
  assert.equal(hasPidginStyleCue("normal formal english"), false);
});

test("normalizePidginFamilyTerms maps family terms", () => {
  assert.equal(normalizePidginFamilyTerms("my mum and dad"), "my Mama and Papa");
});

test("detectPidginContext surfaces intent flags and token hits", () => {
  const detection = detectPidginContext({
    inboundText: "abeg no vex, make we yarn later",
    historyLines: ["Them: we still dey on for tomorrow?"],
  });
  assert.equal(detection.isPidgin, true);
  assert.equal(detection.intents.pause, true);
  assert.equal(detection.intents.recall, true);
  assert.ok(detection.tokenHits.includes("abeg"));
});

test("classifyPidginCandidateTerm boosts terms from Nigerian Pidgin source categories", () => {
  const result = classifyPidginCandidateTerm({
    term: "troway",
    sourceCategories: ["Category:Nigerian Pidgin verbs"],
  });
  assert.ok(result.score >= 0.35);
  assert.equal(result.safety, "safe");
});

test("classifyPidginCandidateTerm blocks sensitive category terms", () => {
  const result = classifyPidginCandidateTerm({
    term: "example-term",
    sourceCategories: ["Category:Nigerian Pidgin offensive terms"],
  });
  assert.equal(result.safety, "blocked");
});

test("buildPidginReplyInstruction enforces Mama/Papa guidance in pidgin mode", () => {
  const pidginInstruction = buildPidginReplyInstruction(true);
  const englishInstruction = buildPidginReplyInstruction(false);
  assert.ok(pidginInstruction.includes("Mama"));
  assert.ok(pidginInstruction.includes("Papa"));
  assert.equal(englishInstruction.includes("standard conversational English"), true);
});
