import assert from "node:assert/strict";
import test from "node:test";
import { buildDeterministicProfessionalReply, decideProfessionalPolicy } from "./professional-policy";

test("professional policy activates for professional profile + work cue", () => {
  const policy = decideProfessionalPolicy({
    inboundText: "Can you share the invoice and ETA?",
    historyLines: ["Them: Need the contract update"],
    profileSlug: "professional",
  });
  assert.equal(policy.forceDeterministicProfessional, true);
  assert.equal(policy.reason, "professional_structured_response");
});

test("professional policy stays off outside professional profile", () => {
  const policy = decideProfessionalPolicy({
    inboundText: "Can you share the invoice and ETA?",
    historyLines: [],
    profileSlug: "relationship",
  });
  assert.equal(policy.forceDeterministicProfessional, false);
});

test("deterministic professional reply includes clear next-step framing", () => {
  const reply = buildDeterministicProfessionalReply("Can we schedule a follow-up meeting?");
  assert.match(reply, /Proposed next step/i);
  assert.match(reply, /agenda|owners/i);
});
