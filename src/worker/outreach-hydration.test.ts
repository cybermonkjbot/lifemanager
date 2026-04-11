import assert from "node:assert/strict";
import test from "node:test";
import { buildOutreachFallbackText, buildOutreachPromptSeed } from "./outreach-hydration";

test("buildOutreachPromptSeed enforces constrained good-morning lead prompt", () => {
  const prompt = buildOutreachPromptSeed({
    outreachMode: "good_morning",
    romanceMorningMode: "lead",
    romancePromptVariant: 1,
    memorySummary: "Memory summary: loves soft mornings.",
    contactName: "Ada",
  });

  assert.match(prompt, /adaptive good-morning opener/i);
  assert.match(prompt, /Mode: lead\./);
  assert.match(prompt, /Lead the opener with affectionate momentum and one concrete invite\./);
  assert.match(prompt, /Keep it to 1-2 short sentences in natural chat language\./);
  assert.match(prompt, /No robotic, assistant, task-manager, or sales wording\./);
  assert.match(prompt, /At most one gentle question and at most one emoji\./);
  assert.match(prompt, /Contact first name: Ada/);
});

test("buildOutreachPromptSeed keeps proactive branch shape unchanged", () => {
  const prompt = buildOutreachPromptSeed({
    outreachMode: "proactive",
    ghostReopenInstruction: "This is a long-silence re-open.",
    memorySummary: "Memory summary: likes football.",
    contactName: "Tobi",
  });

  assert.match(prompt, /Proactively start a fresh check-in conversation with this contact now\./);
  assert.match(prompt, /Use previous chat context so the opener feels natural, specific, and warm\./);
  assert.match(prompt, /include exactly one gentle question/);
  assert.match(prompt, /This is a long-silence re-open\./);
  assert.match(prompt, /Contact first name: Tobi/);
});

test("buildOutreachFallbackText uses mode-aware good-morning fallback", () => {
  const lead = buildOutreachFallbackText({
    outreachMode: "good_morning",
    romanceMorningMode: "lead",
    longSilenceGhostReopen: true,
    ghostReopenTone: "naija_tease",
    ghostSeverity: "severe",
  });
  const warm = buildOutreachFallbackText({
    outreachMode: "good_morning",
    romanceMorningMode: "warm",
    longSilenceGhostReopen: true,
    ghostReopenTone: "hard_banter",
    ghostSeverity: "severe",
  });

  assert.equal(lead, "Good morning, I want to make today sweet for us. What time works for a quick plan later?");
  assert.equal(warm, "Good morning, sending you warm energy. How are you feeling this morning?");
});

test("buildOutreachFallbackText keeps proactive fallback behavior", () => {
  const defaultFallback = buildOutreachFallbackText({
    outreachMode: "proactive",
    longSilenceGhostReopen: false,
    ghostReopenTone: "warm",
    ghostSeverity: "mild",
  });
  const ghostFallback = buildOutreachFallbackText({
    outreachMode: "proactive",
    longSilenceGhostReopen: true,
    ghostReopenTone: "hard_banter",
    ghostSeverity: "severe",
  });

  assert.equal(defaultFallback, "Hey, just checking in. How is your day going?");
  assert.equal(ghostFallback, "You sly mf, you ghosted me 😭. You good though?");
});
