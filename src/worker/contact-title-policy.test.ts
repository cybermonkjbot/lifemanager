import assert from "node:assert/strict";
import test from "node:test";
import { selectPreferredSenderTitle } from "./contact-title-policy";

test("selectPreferredSenderTitle prefers strongest current source", () => {
  const selected = selectPreferredSenderTitle({
    candidates: [
      { title: "Josh Label", rank: 5 },
      { title: "Push Name", rank: 2 },
    ],
  });
  assert.deepEqual(selected, { title: "Josh Label", rank: 5 });
});

test("selectPreferredSenderTitle keeps stronger existing name over weaker new source", () => {
  const selected = selectPreferredSenderTitle({
    existingPreferred: { title: "Josh Label", rank: 5 },
    candidates: [{ title: "Push Name", rank: 2 }],
  });
  assert.deepEqual(selected, { title: "Josh Label", rank: 5 });
});

test("selectPreferredSenderTitle upgrades when stronger source appears", () => {
  const selected = selectPreferredSenderTitle({
    existingPreferred: { title: "Push Name", rank: 2 },
    candidates: [{ title: "Josh Label", rank: 5 }],
  });
  assert.deepEqual(selected, { title: "Josh Label", rank: 5 });
});

