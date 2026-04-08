import assert from "node:assert/strict";
import test from "node:test";
import { decideOlderContextUsage } from "./context-recall-policy";

test("decideOlderContextUsage allows older context when inbound explicitly recalls prior chat", () => {
  const now = Date.now();
  const result = decideOlderContextUsage({
    inboundText: "Following up on what we discussed earlier.",
    messages: [{ messageAt: now - 5 * 24 * 60 * 60 * 1000 }, { messageAt: now }],
  });

  assert.equal(result.allowOlderContext, true);
  assert.equal(result.explicitRecallCue, true);
  assert.equal(result.reason, "explicit_recall_cue");
});

test("decideOlderContextUsage blocks older context on stale thread without recall cue", () => {
  const now = Date.now();
  const result = decideOlderContextUsage({
    inboundText: "Hey",
    messages: [{ messageAt: now - 3 * 24 * 60 * 60 * 1000 }, { messageAt: now }],
  });

  assert.equal(result.allowOlderContext, false);
  assert.equal(result.reason, "stale_thread_without_cue");
  assert.equal(result.staleThread, true);
});

test("decideOlderContextUsage allows older context in active threads", () => {
  const now = Date.now();
  const result = decideOlderContextUsage({
    inboundText: "yes that works",
    messages: [{ messageAt: now - 8 * 60 * 1000 }, { messageAt: now }],
  });

  assert.equal(result.allowOlderContext, true);
  assert.equal(result.reason, "active_thread");
});

test("decideOlderContextUsage treats Gen Z callback phrasing as explicit recall cue", () => {
  const now = Date.now();
  const result = decideOlderContextUsage({
    inboundText: "we still on for tmr?",
    messages: [{ messageAt: now - 4 * 24 * 60 * 60 * 1000 }, { messageAt: now }],
  });

  assert.equal(result.allowOlderContext, true);
  assert.equal(result.explicitRecallCue, true);
  assert.equal(result.reason, "explicit_recall_cue");
});

test("decideOlderContextUsage treats 'you said you'd' phrasing as explicit recall cue", () => {
  const now = Date.now();
  const result = decideOlderContextUsage({
    inboundText: "you said you'd send that yesterday",
    messages: [{ messageAt: now - 2 * 24 * 60 * 60 * 1000 }, { messageAt: now }],
  });

  assert.equal(result.allowOlderContext, true);
  assert.equal(result.explicitRecallCue, true);
  assert.equal(result.reason, "explicit_recall_cue");
});

test("decideOlderContextUsage treats resend prompts as explicit recall cue", () => {
  const now = Date.now();
  const result = decideOlderContextUsage({
    inboundText: "did you send that file?",
    messages: [{ messageAt: now - 2 * 24 * 60 * 60 * 1000 }, { messageAt: now }],
  });

  assert.equal(result.allowOlderContext, true);
  assert.equal(result.explicitRecallCue, true);
  assert.equal(result.reason, "explicit_recall_cue");
});

test("decideOlderContextUsage treats still-down phrasing as explicit recall cue", () => {
  const now = Date.now();
  const result = decideOlderContextUsage({
    inboundText: "still down for later?",
    messages: [{ messageAt: now - 2 * 24 * 60 * 60 * 1000 }, { messageAt: now }],
  });

  assert.equal(result.allowOlderContext, true);
  assert.equal(result.explicitRecallCue, true);
  assert.equal(result.reason, "explicit_recall_cue");
});

test("decideOlderContextUsage treats circle-back phrasing as explicit recall cue", () => {
  const now = Date.now();
  const result = decideOlderContextUsage({
    inboundText: "circle back on this",
    messages: [{ messageAt: now - 2 * 24 * 60 * 60 * 1000 }, { messageAt: now }],
  });

  assert.equal(result.allowOlderContext, true);
  assert.equal(result.explicitRecallCue, true);
  assert.equal(result.reason, "explicit_recall_cue");
});

test("decideOlderContextUsage treats pidgin still-on phrasing as explicit recall cue", () => {
  const now = Date.now();
  const result = decideOlderContextUsage({
    inboundText: "we still dey on for tomorrow?",
    messages: [{ messageAt: now - 2 * 24 * 60 * 60 * 1000 }, { messageAt: now }],
  });

  assert.equal(result.allowOlderContext, true);
  assert.equal(result.explicitRecallCue, true);
  assert.equal(result.reason, "explicit_recall_cue");
});

test("decideOlderContextUsage treats pidgin send-commit phrasing as explicit recall cue", () => {
  const now = Date.now();
  const result = decideOlderContextUsage({
    inboundText: "you talk say you go send am",
    messages: [{ messageAt: now - 2 * 24 * 60 * 60 * 1000 }, { messageAt: now }],
  });

  assert.equal(result.allowOlderContext, true);
  assert.equal(result.explicitRecallCue, true);
  assert.equal(result.reason, "explicit_recall_cue");
});

test("decideOlderContextUsage treats 'how far with that plan' as explicit recall cue", () => {
  const now = Date.now();
  const result = decideOlderContextUsage({
    inboundText: "how far with that plan?",
    messages: [{ messageAt: now - 2 * 24 * 60 * 60 * 1000 }, { messageAt: now }],
  });

  assert.equal(result.allowOlderContext, true);
  assert.equal(result.explicitRecallCue, true);
  assert.equal(result.reason, "explicit_recall_cue");
});

test("decideOlderContextUsage treats 'did u send dat file' as explicit recall cue", () => {
  const now = Date.now();
  const result = decideOlderContextUsage({
    inboundText: "did u send dat file?",
    messages: [{ messageAt: now - 2 * 24 * 60 * 60 * 1000 }, { messageAt: now }],
  });

  assert.equal(result.allowOlderContext, true);
  assert.equal(result.explicitRecallCue, true);
  assert.equal(result.reason, "explicit_recall_cue");
});

test("decideOlderContextUsage treats 'any upd8' as explicit recall cue", () => {
  const now = Date.now();
  const result = decideOlderContextUsage({
    inboundText: "any upd8?",
    messages: [{ messageAt: now - 2 * 24 * 60 * 60 * 1000 }, { messageAt: now }],
  });

  assert.equal(result.allowOlderContext, true);
  assert.equal(result.explicitRecallCue, true);
  assert.equal(result.reason, "explicit_recall_cue");
});

test("decideOlderContextUsage treats 'hw far wit that plan' as explicit recall cue", () => {
  const now = Date.now();
  const result = decideOlderContextUsage({
    inboundText: "hw far wit that plan?",
    messages: [{ messageAt: now - 2 * 24 * 60 * 60 * 1000 }, { messageAt: now }],
  });

  assert.equal(result.allowOlderContext, true);
  assert.equal(result.explicitRecallCue, true);
  assert.equal(result.reason, "explicit_recall_cue");
});

test("decideOlderContextUsage treats 'you don send am' as explicit recall cue", () => {
  const now = Date.now();
  const result = decideOlderContextUsage({
    inboundText: "you don send am?",
    messages: [{ messageAt: now - 2 * 24 * 60 * 60 * 1000 }, { messageAt: now }],
  });

  assert.equal(result.allowOlderContext, true);
  assert.equal(result.explicitRecallCue, true);
  assert.equal(result.reason, "explicit_recall_cue");
});

test("decideOlderContextUsage treats 'abeg any update' as explicit recall cue", () => {
  const now = Date.now();
  const result = decideOlderContextUsage({
    inboundText: "abeg any update on that one?",
    messages: [{ messageAt: now - 2 * 24 * 60 * 60 * 1000 }, { messageAt: now }],
  });

  assert.equal(result.allowOlderContext, true);
  assert.equal(result.explicitRecallCue, true);
  assert.equal(result.reason, "explicit_recall_cue");
});

test("decideOlderContextUsage treats 'wetin happen to that plan' as explicit recall cue", () => {
  const now = Date.now();
  const result = decideOlderContextUsage({
    inboundText: "wetin happen to that plan?",
    messages: [{ messageAt: now - 2 * 24 * 60 * 60 * 1000 }, { messageAt: now }],
  });

  assert.equal(result.allowOlderContext, true);
  assert.equal(result.explicitRecallCue, true);
  assert.equal(result.reason, "explicit_recall_cue");
});

test("decideOlderContextUsage treats 'abeg remind me' as explicit recall cue", () => {
  const now = Date.now();
  const result = decideOlderContextUsage({
    inboundText: "abeg remind me about that thing",
    messages: [{ messageAt: now - 2 * 24 * 60 * 60 * 1000 }, { messageAt: now }],
  });

  assert.equal(result.allowOlderContext, true);
  assert.equal(result.explicitRecallCue, true);
  assert.equal(result.reason, "explicit_recall_cue");
});

test("decideOlderContextUsage treats 'fit send am again' as explicit recall cue", () => {
  const now = Date.now();
  const result = decideOlderContextUsage({
    inboundText: "you fit send am again?",
    messages: [{ messageAt: now - 2 * 24 * 60 * 60 * 1000 }, { messageAt: now }],
  });

  assert.equal(result.allowOlderContext, true);
  assert.equal(result.explicitRecallCue, true);
  assert.equal(result.reason, "explicit_recall_cue");
});
