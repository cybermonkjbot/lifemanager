import assert from "node:assert/strict";
import test from "node:test";
import { computeConversationStyleMatrix } from "./conversation-style-matrix";

test("conversation style matrix detects family support", () => {
  const matrix = computeConversationStyleMatrix({
    inboundText: "Mum has been sick and I am worried.",
  });
  assert.equal(matrix.relationship, "family");
  assert.equal(matrix.riskSensitivity, "health");
  assert.equal(matrix.interactionMove, "comfort");
  assert.ok(matrix.dynamicStylePackIds.includes("family_core.v1"));
  assert.ok(matrix.dynamicStylePackIds.includes("grief_support.v1"));
});

test("conversation style matrix detects conflict repair", () => {
  const matrix = computeConversationStyleMatrix({
    inboundText: "That came off harsh and it hurt me.",
    recentHistoryLines: ["Them: I don't like how you replied yesterday."],
  });
  assert.equal(matrix.riskSensitivity, "conflict");
  assert.equal(matrix.interactionMove, "repair");
  assert.equal(matrix.politeness, "repair_accountability");
  assert.ok(matrix.dynamicStylePackIds.includes("conflict_repair.v1"));
});

test("conversation style matrix detects community group chat", () => {
  const matrix = computeConversationStyleMatrix({
    inboundText: "Guys can everyone confirm who is coming?",
    threadKind: "group",
  });
  assert.equal(matrix.relationship, "community_group");
  assert.ok(matrix.dynamicStylePackIds.includes("group_community.v1"));
});

test("conversation style matrix detects vendor/service and strips emoji", () => {
  const matrix = computeConversationStyleMatrix({
    inboundText: "Please send the receipt for my delivery refund.",
    profileSlug: "vendor_service",
  });
  assert.equal(matrix.relationship, "vendor_service");
  assert.equal(matrix.register, "professional");
  assert.equal(matrix.emojiTextPolicy, "strip");
});

test("conversation style matrix detects mentorship advice", () => {
  const matrix = computeConversationStyleMatrix({
    inboundText: "Can you mentor me and review my career plan?",
    profileSlug: "mentorship",
  });
  assert.ok(matrix.dynamicStylePackIds.includes("mentorship.v1"));
  assert.equal(matrix.interactionMove, "advise");
});

test("conversation style matrix detects romantic emoji eligible style", () => {
  const matrix = computeConversationStyleMatrix({
    inboundText: "I miss you lol",
    profileSlug: "girlfriend",
    learnedEmojiAllowlist: ["😌"],
  });
  assert.equal(matrix.relationship, "romantic");
  assert.equal(matrix.emojiTextPolicy, "allow_limited");
});

test("conversation style matrix detects Nigerian Pidgin", () => {
  const matrix = computeConversationStyleMatrix({
    inboundText: "Abeg how far, make we move this thing?",
  });
  assert.equal(matrix.localeDialect, "nigerian_pidgin");
  assert.ok(matrix.reasonCodes.includes("locale_nigerian_pidgin"));
});

test("conversation style matrix detects ambiguous referents", () => {
  const matrix = computeConversationStyleMatrix({
    inboundText: "Which one?",
  });
  assert.equal(matrix.interactionMove, "clarify");
});
