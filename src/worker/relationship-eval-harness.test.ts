import assert from "node:assert/strict";
import test from "node:test";
import { buildDeterministicRepairReply, decideRelationshipPolicy } from "./relationship-policy";

type EvalCase = {
  id: string;
  inbound: string;
  history: string[];
  expectRepair: boolean;
  mustInclude?: RegExp[];
  mustNotInclude?: RegExp[];
};

const CASES: EvalCase[] = [
  {
    id: "jealousy_probe",
    inbound: "Who were you chatting with since morning?",
    history: ["Them: answer me straight"],
    expectRepair: true,
    mustInclude: [/I hear/i],
    mustNotInclude: [/lol|😂|🤣/i],
  },
  {
    id: "passive_aggressive",
    inbound: "No worry, enjoy.",
    history: ["Them: You ignored me yesterday"],
    expectRepair: true,
    mustInclude: [/frustration|I hear/i],
    mustNotInclude: [/joke|lol|😂|🤣/i],
  },
  {
    id: "accusation",
    inbound: "You were seen at Terminus, why no pick?",
    history: ["Them: Be honest"],
    expectRepair: true,
    mustInclude: [/I hear/i],
    mustNotInclude: [/definitely|exactly happened/i],
  },
  {
    id: "playful_safe",
    inbound: "lol your banter is wild",
    history: ["Them: I appreciate you"],
    expectRepair: false,
  },
  {
    id: "hurt_statement",
    inbound: "That hurt me honestly",
    history: ["Them: you embarrassed me in front of my friend"],
    expectRepair: true,
    mustInclude: [/right to call this out|I hear you/i],
    mustNotInclude: [/but you|calm down/i],
  },
  {
    id: "romantic_conflict",
    inbound: "Babe you ignored me and I feel disrespected",
    history: ["Them: this relationship matters to me"],
    expectRepair: true,
    mustInclude: [/I care about us|I hear you/i],
    mustNotInclude: [/lol|😂|🤣/i],
  },
];

for (const item of CASES) {
  test(`relationship-eval: ${item.id}`, () => {
    const policy = decideRelationshipPolicy({
      inboundText: item.inbound,
      historyLines: item.history,
      profileSlug: item.id === "romantic_conflict" ? "relationship" : undefined,
    });

    assert.equal(policy.forceDeterministicRepair, item.expectRepair);

    if (!item.expectRepair) {
      return;
    }

    const reply = buildDeterministicRepairReply({
      inboundText: item.inbound,
      state: policy.state,
      prioritizeRomanticCare: policy.prioritizeRomanticCare,
    });

    for (const pattern of item.mustInclude || []) {
      assert.match(reply, pattern);
    }
    for (const pattern of item.mustNotInclude || []) {
      assert.doesNotMatch(reply, pattern);
    }
  });
}
