import assert from "node:assert/strict";
import test from "node:test";
import { buildOutreachFallbackText, buildOutreachPromptSeed, enforceGoodMorningStyleLint } from "./outreach-hydration";

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
  assert.match(prompt, /Always write 'Good morning' in full, never 'GM' or shorthand variants\./);
  assert.match(prompt, /Use plain conversational English only; do not use pidgin wording\./);
  assert.match(prompt, /No robotic, assistant, task-manager, or sales wording\./);
  assert.match(prompt, /At most one gentle question and at most one emoji\./);
  assert.match(prompt, /Contact first name: Ada/);
});

test("buildOutreachPromptSeed includes boundary reopen guidance after ignored pause", () => {
  const prompt = buildOutreachPromptSeed({
    outreachMode: "good_morning",
    romanceMorningMode: "warm",
    romancePromptVariant: 2,
    ignoredBoundaryReopen: true,
    contactName: "Ada",
  });

  assert.match(prompt, /calm re-open after a 3-day pause due to silence/i);
  assert.match(prompt, /being ignored did not feel good/i);
  assert.match(prompt, /do not blame, pressure, guilt-trip, or sound hostile/i);
});

test("boundary reopen guidance cycles across extended variant set", () => {
  const promptLow = buildOutreachPromptSeed({
    outreachMode: "good_morning",
    romanceMorningMode: "warm",
    romancePromptVariant: 0,
    ignoredBoundaryReopen: true,
    contactName: "Ada",
  });
  const promptHigh = buildOutreachPromptSeed({
    outreachMode: "good_morning",
    romanceMorningMode: "warm",
    romancePromptVariant: 22,
    ignoredBoundaryReopen: true,
    contactName: "Ada",
  });

  assert.notEqual(promptLow, promptHigh);
  assert.match(promptHigh, /composure/i);
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

test("buildOutreachFallbackText uses boundary reopen fallback after ignored pause", () => {
  const fallbackA = buildOutreachFallbackText({
    outreachMode: "good_morning",
    romanceMorningMode: "warm",
    romancePromptVariant: 0,
    ignoredBoundaryReopen: true,
    longSilenceGhostReopen: false,
    ghostReopenTone: "warm",
    ghostSeverity: "mild",
  });
  const fallbackB = buildOutreachFallbackText({
    outreachMode: "good_morning",
    romanceMorningMode: "warm",
    romancePromptVariant: 1,
    ignoredBoundaryReopen: true,
    longSilenceGhostReopen: false,
    ghostReopenTone: "warm",
    ghostSeverity: "mild",
  });
  const fallbackC = buildOutreachFallbackText({
    outreachMode: "good_morning",
    romanceMorningMode: "warm",
    romancePromptVariant: 2,
    ignoredBoundaryReopen: true,
    longSilenceGhostReopen: false,
    ghostReopenTone: "warm",
    ghostSeverity: "mild",
  });
  const fallbackZ = buildOutreachFallbackText({
    outreachMode: "good_morning",
    romanceMorningMode: "warm",
    romancePromptVariant: 22,
    ignoredBoundaryReopen: true,
    longSilenceGhostReopen: false,
    ghostReopenTone: "warm",
    ghostSeverity: "mild",
  });

  assert.equal(
    fallbackA,
    "Good morning, I did not enjoy being ghosted, but I am choosing peace and still checking on you. Are you okay?",
  );
  assert.equal(
    fallbackB,
    "Good morning, I did not like how we went silent, but I am taking the higher road and checking on you. Are you alright?",
  );
  assert.equal(
    fallbackC,
    "Good morning, being ignored did not feel good, but I am choosing calm and still checking on you. How are you today?",
  );
  assert.equal(
    fallbackZ,
    "Good morning, I did not enjoy being ignored, yet I am choosing composure and still checking on you. Are you alright today?",
  );
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

test("enforceGoodMorningStyleLint rewrites long/question-heavy/emoji-heavy text", () => {
  const linted = enforceGoodMorningStyleLint({
    text: "Good morning babe 😍😍. I miss you. What are you up to today? Will you call me later?",
    fallbackText: "Good morning, sending you warm energy. How are you feeling this morning?",
  });

  assert.match(linted.text, /^Good morning babe/);
  assert.equal((linted.text.match(/\?/g) || []).length <= 1, true);
  assert.equal((linted.text.match(/[\p{Extended_Pictographic}\p{Regional_Indicator}]/gu) || []).length <= 1, true);
  assert.ok(linted.violations.includes("too_many_sentences"));
  assert.ok(linted.violations.includes("too_many_questions"));
  assert.ok(linted.violations.includes("too_many_emojis"));
});

test("enforceGoodMorningStyleLint falls back on robotic or pressure cues", () => {
  const fallback = "Good morning, sending you warm energy. How are you feeling this morning?";
  const robotic = enforceGoodMorningStyleLint({
    text: "As your assistant workflow, this is your scheduled protocol reminder.",
    fallbackText: fallback,
  });
  const pressure = enforceGoodMorningStyleLint({
    text: "Good morning. Reply now and stop ignoring me.",
    fallbackText: fallback,
  });

  assert.equal(robotic.text, fallback);
  assert.ok(robotic.violations.includes("robotic_task_wording"));
  assert.equal(pressure.text, fallback);
  assert.ok(pressure.violations.includes("pressure_or_guilt_wording"));
});

test("enforceGoodMorningStyleLint normalizes GM shorthand and morning prefix", () => {
  const linted = enforceGoodMorningStyleLint({
    text: "GM bby, thinking of you.",
    fallbackText: "Good morning, sending you warm energy. How are you feeling this morning?",
  });
  const lintedMorning = enforceGoodMorningStyleLint({
    text: "Morning love, hope you're good.",
    fallbackText: "Good morning, sending you warm energy. How are you feeling this morning?",
  });

  assert.match(linted.text, /^Good morning\b/);
  assert.match(lintedMorning.text, /^Good morning\b/);
  assert.ok(linted.violations.includes("good_morning_opening_normalized"));
});

test("enforceGoodMorningStyleLint blocks pidgin wording", () => {
  const fallback = "Good morning, sending you warm energy. How are you feeling this morning?";
  const linted = enforceGoodMorningStyleLint({
    text: "Good morning bby, shey you dey alright?",
    fallbackText: fallback,
  });

  assert.equal(linted.text, fallback);
  assert.ok(linted.violations.includes("pidgin_wording"));
});
