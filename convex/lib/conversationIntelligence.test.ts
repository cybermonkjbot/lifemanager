import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSignalExcerpt,
  detectCheckInSignal,
  detectCheckInSignalType,
  evaluateLeadPivotSafety,
  hasTopicCloseCue,
  inferTopicFromText,
  isTrackableTopicMessageType,
  normalizeConversationText,
  resolveTopicFromText,
} from "./conversationIntelligence";

test("detectCheckInSignalType recognizes English and Naija check-in prompts", () => {
  assert.equal(detectCheckInSignalType("How are you doing today?"), "checkin_prompt");
  assert.equal(detectCheckInSignalType("How you dey this week?"), "checkin_prompt");
  assert.equal(detectCheckInSignalType("hope say you dey okay"), "checkin_prompt");
  assert.equal(detectCheckInSignalType("you good?"), "checkin_prompt");
  assert.equal(detectCheckInSignalType("how's your mind today?"), "checkin_prompt");
  assert.equal(detectCheckInSignalType("you've been quiet, hope you're holding up"), "checkin_prompt");
  assert.equal(detectCheckInSignalType("checking on you"), "checkin_prompt");
});

test("detectCheckInSignalType recognizes check-in responses", () => {
  assert.equal(detectCheckInSignalType("I am good, thank you."), "checkin_response");
  assert.equal(detectCheckInSignalType("I dey okay now."), "checkin_response");
  assert.equal(detectCheckInSignalType("all good on my side"), "checkin_response");
  assert.equal(detectCheckInSignalType("I'm hanging in there"), "checkin_response");
  assert.equal(detectCheckInSignalType("we dey manage"), "checkin_response");
});

test("detectCheckInSignalType returns null for non-check-in text", () => {
  assert.equal(detectCheckInSignalType("Let's ship this feature tonight."), null);
  assert.equal(detectCheckInSignalType("How far is the office from here?"), null);
});

test("detectCheckInSignal returns confidence metadata", () => {
  const detected = detectCheckInSignal("How are you doing?");
  assert.equal(detected?.signalType, "checkin_prompt");
  assert.ok((detected?.confidence || 0) >= 0.7);
});

test("isTrackableTopicMessageType excludes reaction and sticker", () => {
  assert.equal(isTrackableTopicMessageType("text"), true);
  assert.equal(isTrackableTopicMessageType("image"), true);
  assert.equal(isTrackableTopicMessageType("reaction"), false);
  assert.equal(isTrackableTopicMessageType("sticker"), false);
});

test("normalizeConversationText and buildSignalExcerpt sanitize text", () => {
  assert.equal(normalizeConversationText("  How   You DEY  "), "how you dey");
  assert.equal(buildSignalExcerpt("   short text   ", 60), "short text");
  assert.equal(buildSignalExcerpt("x".repeat(220), 20), "xxxxxxxxxxxxxxxxx...");
});

test("inferTopicFromText classifies common lanes", () => {
  assert.equal(inferTopicFromText("Let us schedule meeting for tomorrow").topicKey, "plans");
  assert.equal(inferTopicFromText("Client deadline is close").topicKey, "work_admin");
  assert.equal(inferTopicFromText("I need to make transfer").topicKey, "finances");
});

test("hasTopicCloseCue detects close-out language", () => {
  assert.equal(hasTopicCloseCue("okay talk later"), true);
  assert.equal(hasTopicCloseCue("have a good night"), true);
  assert.equal(hasTopicCloseCue("talk tommorrow"), true);
  assert.equal(hasTopicCloseCue("gn"), true);
  assert.equal(hasTopicCloseCue("see you tomorrow"), true);
  assert.equal(hasTopicCloseCue("catch you tmr"), true);
  assert.equal(hasTopicCloseCue("talk to you in the morning"), true);
  assert.equal(hasTopicCloseCue("I'll ping you tmr"), true);
  assert.equal(hasTopicCloseCue("make i sleep"), true);
  assert.equal(hasTopicCloseCue("that is all for now"), true);
  assert.equal(hasTopicCloseCue("last night was funny"), false);
  assert.equal(hasTopicCloseCue("tomorrow meeting is at 9"), false);
  assert.equal(hasTopicCloseCue("send me the file quickly"), false);
});

test("resolveTopicFromText keeps lane continuity when text is short follow-up", () => {
  const resolved = resolveTopicFromText({
    text: "okay, we fit continue that one then",
    currentPrimaryTopicKey: "work_admin",
    laneHints: [
      {
        topicKey: "work_admin",
        topicLabel: "Work/Admin",
        status: "active",
        lastMessageAt: 200,
      },
    ],
  });

  assert.equal(resolved.topicKey, "work_admin");
  assert.notEqual(resolved.source, "fallback_general");
});

test("resolveTopicFromText uses lane overlap when lexical pattern is weak", () => {
  const resolved = resolveTopicFromText({
    text: "my wellbeing recovery and energy no dey stable yet",
    currentPrimaryTopicKey: "plans",
    laneHints: [
      {
        topicKey: "plans",
        topicLabel: "Plans",
        status: "active",
        lastMessageAt: 300,
      },
      {
        topicKey: "wellbeing",
        topicLabel: "Wellbeing",
        status: "cooling",
        lastMessageAt: 280,
      },
    ],
  });

  assert.equal(resolved.topicKey, "wellbeing");
  assert.equal(resolved.source, "lane_overlap");
});

test("resolveTopicFromText falls back to general for unrelated text", () => {
  const resolved = resolveTopicFromText({
    text: "we watched that movie last night",
    laneHints: [
      {
        topicKey: "finances",
        topicLabel: "Finances",
        status: "active",
        lastMessageAt: 220,
      },
    ],
  });

  assert.equal(resolved.topicKey, "general");
  assert.equal(resolved.source, "fallback_general");
});

test("resolveTopicFromText detects expanded conversational lanes", () => {
  assert.equal(resolveTopicFromText({ text: "That came off harsh and it hurt" }).topicKey, "repair");
  assert.equal(resolveTopicFromText({ text: "Congrats on the promotion" }).topicKey, "celebration");
  assert.equal(resolveTopicFromText({ text: "Can you mentor me on this career path?" }).topicKey, "advice");
  assert.equal(resolveTopicFromText({ text: "Please send the delivery refund receipt" }).topicKey, "service_complaint");
});

test("evaluateLeadPivotSafety allows pivot only in safe exhausted context", () => {
  const allowed = evaluateLeadPivotSafety({
    conversationIntelligenceEnabled: true,
    pivotReplyEnabled: true,
    topicLeadPivotEnabled: true,
    shouldClose: false,
    conflictCue: false,
    pauseCue: false,
    leadCooldownActive: false,
    topicDwellScore: 0.68,
    vibeScore: 0.74,
    minVibeScore: 0.6,
    laneExhausted: true,
    explicitAskCue: false,
    unansweredOutboundStreak: 0,
  });
  assert.equal(allowed.eligible, true);
  assert.deepEqual(allowed.reasonCodes, ["lead_pivot"]);
});

test("evaluateLeadPivotSafety blocks pivot for explicit asks and unanswered outbound pressure", () => {
  const blocked = evaluateLeadPivotSafety({
    conversationIntelligenceEnabled: true,
    pivotReplyEnabled: true,
    topicLeadPivotEnabled: true,
    shouldClose: false,
    conflictCue: false,
    pauseCue: false,
    leadCooldownActive: false,
    topicDwellScore: 0.7,
    vibeScore: 0.78,
    minVibeScore: 0.6,
    laneExhausted: true,
    explicitAskCue: true,
    unansweredOutboundStreak: 2,
    maxUnansweredOutboundStreak: 1,
  });
  assert.equal(blocked.eligible, false);
  assert.equal(blocked.reasonCodes.includes("lead_block_explicit_ask"), true);
  assert.equal(blocked.reasonCodes.includes("lead_block_unanswered_outbound"), true);
});

test("evaluateLeadPivotSafety blocks pivot for high-risk or low-confidence style matrix", () => {
  const baseInput = {
    conversationIntelligenceEnabled: true,
    pivotReplyEnabled: true,
    topicLeadPivotEnabled: true,
    shouldClose: false,
    conflictCue: false,
    pauseCue: false,
    leadCooldownActive: false,
    topicDwellScore: 0.7,
    vibeScore: 0.78,
    minVibeScore: 0.6,
    laneExhausted: true,
    explicitAskCue: false,
    unansweredOutboundStreak: 0,
  };
  const blocked = evaluateLeadPivotSafety({
    ...baseInput,
    styleMatrixRisk: "health",
    styleMatrixConfidence: 0.86,
  });
  assert.equal(blocked.eligible, false);
  assert.equal(blocked.reasonCodes.includes("lead_block_high_risk_style"), true);

  const lowConfidence = evaluateLeadPivotSafety({
    ...baseInput,
    styleMatrixRisk: "none",
    styleMatrixConfidence: 0.32,
  });
  assert.equal(lowConfidence.eligible, false);
  assert.equal(lowConfidence.reasonCodes.includes("lead_block_low_style_confidence"), true);
});
