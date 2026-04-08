import assert from "node:assert/strict";
import test from "node:test";
import { assessProfessionalConversation, isSeriousConversationText } from "./memePolicy";

test("assessProfessionalConversation flags business-heavy threads as professional", () => {
  const result = assessProfessionalConversation({
    messages: [
      { text: "Please share the invoice before our client meeting.", direction: "inbound", messageType: "text" },
      { text: "Sure, I will send the proposal and timeline today.", direction: "outbound", messageType: "text" },
      { text: "Need final approval and sign-off by Friday.", direction: "inbound", messageType: "text" },
    ],
    latestInboundText: "Can we align on deliverables and payment terms?",
  });

  assert.equal(result.isProfessional, true);
  assert.ok(result.businessHits >= 4);
});

test("assessProfessionalConversation keeps playful chats non-professional", () => {
  const result = assessProfessionalConversation({
    messages: [
      { text: "lol that meme was crazy 😂", direction: "inbound", messageType: "text" },
      { text: "bro you dey whine me 😹", direction: "outbound", messageType: "text" },
      { text: "haha gist me everything", direction: "inbound", messageType: "text" },
    ],
    latestInboundText: "send another funny one pls",
  });

  assert.equal(result.isProfessional, false);
  assert.ok(result.playfulHits >= 3);
});

test("assessProfessionalConversation treats richer naija casual slang as non-professional", () => {
  const result = assessProfessionalConversation({
    messages: [
      { text: "how far, wetin dey sup?", direction: "inbound", messageType: "text" },
      { text: "no wahala, i go comot now", direction: "outbound", messageType: "text" },
      { text: "drop the tori later padi 😂", direction: "inbound", messageType: "text" },
    ],
    latestInboundText: "abeg send funny one",
  });

  assert.equal(result.isProfessional, false);
  assert.ok(result.playfulHits >= 3);
});

test("isSeriousConversationText detects sensitive terms", () => {
  assert.equal(isSeriousConversationText("Please do not share your OTP with anyone."), true);
  assert.equal(isSeriousConversationText("Let's grab lunch tomorrow."), false);
});
