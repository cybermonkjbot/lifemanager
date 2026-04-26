import assert from "node:assert/strict";
import test from "node:test";
import { decideAutoVoiceNote, parseVoiceNoteDirective } from "./voice-note";

test("decideAutoVoiceNote selects when keyword matches and probability allows", () => {
  const decision = decideAutoVoiceNote({
    text: "Quick update: let me explain exactly what happened.",
    threadId: "thread-1",
    outboxId: "outbox-1",
    dayBucket: "2026-04-24",
    sentToday: 0,
    runtimeConfig: {
      enabled: true,
      probability: 1,
      maxPerThreadPerDay: 2,
      needKeywords: ["quick update", "explain"],
    },
  });

  assert.equal(decision.shouldAttempt, true);
  assert.equal(decision.reason, "selected");
  assert.equal(decision.matchedKeywords.includes("quick update"), true);
});

test("decideAutoVoiceNote skips when cap is reached", () => {
  const decision = decideAutoVoiceNote({
    text: "I want to explain this one with a voice note.",
    threadId: "thread-2",
    outboxId: "outbox-1",
    dayBucket: "2026-04-24",
    sentToday: 2,
    runtimeConfig: {
      enabled: true,
      probability: 1,
      maxPerThreadPerDay: 2,
      needKeywords: ["voice note", "explain"],
    },
  });

  assert.equal(decision.shouldAttempt, false);
  assert.equal(decision.reason, "cap_reached");
});

test("decideAutoVoiceNote skips when no keyword is matched", () => {
  const decision = decideAutoVoiceNote({
    text: "Thanks, I saw your message and will get back later.",
    threadId: "thread-3",
    outboxId: "outbox-1",
    dayBucket: "2026-04-24",
    sentToday: 0,
    runtimeConfig: {
      enabled: true,
      probability: 1,
      maxPerThreadPerDay: 2,
      needKeywords: ["voice note", "walk you through"],
    },
  });

  assert.equal(decision.shouldAttempt, false);
  assert.equal(decision.reason, "need_not_detected");
});

test("parseVoiceNoteDirective marks explicit directives", () => {
  const parsed = parseVoiceNoteDirective("/vn Hello there");
  assert.ok(parsed);
  assert.equal(parsed.source, "explicit");
  assert.equal(parsed.normalizedText, "Hello there");
});

test("parseVoiceNoteDirective marks auto directives", () => {
  const parsed = parseVoiceNoteDirective("/vna Hello there");
  assert.ok(parsed);
  assert.equal(parsed.source, "auto");
  assert.equal(parsed.normalizedText, "Hello there");
});
