import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOutreachFallbackText,
  buildOutreachPromptSeed,
  enforceComplimentStyleLint,
  enforceGoodMorningStyleLint,
} from "./outreach-hydration";

const MORNING_MS = Date.UTC(2026, 0, 1, 9, 0, 0);
const AFTERNOON_MS = Date.UTC(2026, 0, 1, 15, 0, 0);

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

test("buildOutreachPromptSeed adjusts proactive guidance when mutual check-in is recent", () => {
  const prompt = buildOutreachPromptSeed({
    outreachMode: "proactive",
    daysSinceMutualCheckIn: 1,
    checkInRecencyTargetDays: 7,
    contactName: "Tobi",
  });

  assert.match(prompt, /Recent mutual check-in was 1 day\(s\) ago\./);
  assert.match(prompt, /Do not open with a generic "just checking in" line/i);
});

test("buildOutreachPromptSeed nudges wellbeing when mutual check-in is stale or missing", () => {
  const stalePrompt = buildOutreachPromptSeed({
    outreachMode: "proactive",
    daysSinceMutualCheckIn: 12,
    checkInRecencyTargetDays: 7,
    contactName: "Tobi",
  });
  const missingPrompt = buildOutreachPromptSeed({
    outreachMode: "proactive",
    contactName: "Tobi",
  });

  assert.match(stalePrompt, /Last mutual check-in was 12 day\(s\) ago \(target 7 days\)/i);
  assert.match(stalePrompt, /Prioritize a warm wellbeing check-in opener/i);
  assert.match(missingPrompt, /No known mutual check-in on record/i);
});

test("buildOutreachPromptSeed includes compliment constraints for appreciation mode", () => {
  const prompt = buildOutreachPromptSeed({
    outreachMode: "compliment",
    romancePromptVariant: 2,
    memorySummary: "Memory summary: she likes thoughtful words.",
    contactName: "Ada",
  });

  assert.match(prompt, /out-of-the-blue appreciation message/i);
  assert.match(prompt, /Make it feel like a spontaneous compliment/i);
  assert.match(prompt, /Do not ask for validation, commitment, or immediate reply\./);
  assert.match(prompt, /At most one gentle question and at most one emoji\./);
  assert.match(prompt, /Contact first name: Ada/);
});

test("buildOutreachPromptSeed supports playful fake-scenario compliment mode", () => {
  const prompt = buildOutreachPromptSeed({
    outreachMode: "compliment",
    romancePromptVariant: 1,
    complimentPlayfulScenario: true,
    contactName: "Ada",
  });

  assert.match(prompt, /playful fake-scenario message/i);
  assert.match(prompt, /clearly fictional and obviously joke-like/i);
  assert.match(prompt, /No fake-threat stakes about death, emergencies, or abandonment\./);
});

test("buildOutreachFallbackText uses mode-aware good-morning fallback", () => {
  const lead = buildOutreachFallbackText({
    outreachMode: "good_morning",
    romanceMorningMode: "lead",
    longSilenceGhostReopen: true,
    ghostReopenTone: "naija_tease",
    ghostSeverity: "severe",
    nowMs: MORNING_MS,
  });
  const warm = buildOutreachFallbackText({
    outreachMode: "good_morning",
    romanceMorningMode: "warm",
    longSilenceGhostReopen: true,
    ghostReopenTone: "hard_banter",
    ghostSeverity: "severe",
    nowMs: MORNING_MS,
  });

  assert.equal(lead, "Good morning, I want to make today sweet for us. What time works for a quick plan later?");
  assert.equal(warm, "Good morning, sending you warm energy. How are you feeling this morning?");
});

test("buildOutreachFallbackText returns compliment fallback for compliment mode", () => {
  const fallback = buildOutreachFallbackText({
    outreachMode: "compliment",
    longSilenceGhostReopen: false,
    ghostReopenTone: "warm",
    ghostSeverity: "mild",
  });

  assert.equal(
    fallback,
    "You have such a beautiful energy, and I still catch myself smiling when I think of you.",
  );
});

test("buildOutreachFallbackText returns playful compliment fallback when selected", () => {
  const fallback = buildOutreachFallbackText({
    outreachMode: "compliment",
    complimentPlayfulScenario: true,
    longSilenceGhostReopen: false,
    ghostReopenTone: "warm",
    ghostSeverity: "mild",
  });

  assert.equal(
    fallback,
    "Random confession: in my imaginary kingdom, your smile keeps the sun online. You really do brighten my day.",
  );
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
    nowMs: MORNING_MS,
  });
  const fallbackB = buildOutreachFallbackText({
    outreachMode: "good_morning",
    romanceMorningMode: "warm",
    romancePromptVariant: 1,
    ignoredBoundaryReopen: true,
    longSilenceGhostReopen: false,
    ghostReopenTone: "warm",
    ghostSeverity: "mild",
    nowMs: MORNING_MS,
  });
  const fallbackC = buildOutreachFallbackText({
    outreachMode: "good_morning",
    romanceMorningMode: "warm",
    romancePromptVariant: 2,
    ignoredBoundaryReopen: true,
    longSilenceGhostReopen: false,
    ghostReopenTone: "warm",
    ghostSeverity: "mild",
    nowMs: MORNING_MS,
  });
  const fallbackZ = buildOutreachFallbackText({
    outreachMode: "good_morning",
    romanceMorningMode: "warm",
    romancePromptVariant: 22,
    ignoredBoundaryReopen: true,
    longSilenceGhostReopen: false,
    ghostReopenTone: "warm",
    ghostSeverity: "mild",
    nowMs: MORNING_MS,
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

test("buildOutreachFallbackText avoids generic check-in fallback when mutual check-in is recent", () => {
  const fallback = buildOutreachFallbackText({
    outreachMode: "proactive",
    daysSinceMutualCheckIn: 2,
    checkInRecencyTargetDays: 7,
    longSilenceGhostReopen: false,
    ghostReopenTone: "warm",
    ghostSeverity: "mild",
  });

  assert.equal(fallback, "Hey, quick one for today: what has been the highlight of your day so far?");
});

test("enforceGoodMorningStyleLint rewrites long/question-heavy/emoji-heavy text", () => {
  const linted = enforceGoodMorningStyleLint({
    text: "Good morning babe 😍😍. I miss you. What are you up to today? Will you call me later?",
    fallbackText: "Good morning, sending you warm energy. How are you feeling this morning?",
    nowMs: MORNING_MS,
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
    nowMs: MORNING_MS,
  });
  const pressure = enforceGoodMorningStyleLint({
    text: "Good morning. Reply now and stop ignoring me.",
    fallbackText: fallback,
    nowMs: MORNING_MS,
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
    nowMs: MORNING_MS,
  });
  const lintedMorning = enforceGoodMorningStyleLint({
    text: "Morning love, hope you're good.",
    fallbackText: "Good morning, sending you warm energy. How are you feeling this morning?",
    nowMs: MORNING_MS,
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
    nowMs: MORNING_MS,
  });

  assert.equal(linted.text, fallback);
  assert.ok(linted.violations.includes("pidgin_wording"));
});

test("buildOutreachFallbackText uses afternoon greeting outside morning window", () => {
  const warm = buildOutreachFallbackText({
    outreachMode: "good_morning",
    romanceMorningMode: "warm",
    longSilenceGhostReopen: false,
    ghostReopenTone: "warm",
    ghostSeverity: "mild",
    nowMs: AFTERNOON_MS,
  });
  const lead = buildOutreachFallbackText({
    outreachMode: "good_morning",
    romanceMorningMode: "lead",
    longSilenceGhostReopen: false,
    ghostReopenTone: "warm",
    ghostSeverity: "mild",
    nowMs: AFTERNOON_MS,
  });

  assert.equal(warm, "Good afternoon, sending you warm energy. How are you feeling today?");
  assert.equal(lead, "Good afternoon, I want to make today sweet for us. What time works for a quick plan later?");
});

test("enforceComplimentStyleLint rewrites long/question-heavy/emoji-heavy text", () => {
  const linted = enforceComplimentStyleLint({
    text: "You are so stunning 😍😍. I keep thinking about your smile. Are you free now? Can we talk later?",
    fallbackText: "You have such a beautiful energy, and I still catch myself smiling when I think of you.",
  });

  assert.equal((linted.text.match(/\?/g) || []).length <= 1, true);
  assert.equal((linted.text.match(/[\p{Extended_Pictographic}\p{Regional_Indicator}]/gu) || []).length <= 1, true);
  assert.ok(linted.violations.includes("too_many_sentences"));
  assert.ok(linted.violations.includes("too_many_questions"));
  assert.ok(linted.violations.includes("too_many_emojis"));
});

test("enforceComplimentStyleLint falls back on robotic, pressure, or pidgin cues", () => {
  const fallback = "You have such a beautiful energy, and I still catch myself smiling when I think of you.";
  const robotic = enforceComplimentStyleLint({
    text: "As your assistant workflow, this scheduled compliment is now due.",
    fallbackText: fallback,
  });
  const pressure = enforceComplimentStyleLint({
    text: "You are beautiful, reply now.",
    fallbackText: fallback,
  });
  const pidgin = enforceComplimentStyleLint({
    text: "You fine well well, shey you dey okay?",
    fallbackText: fallback,
  });
  const coerciveFakeStake = enforceComplimentStyleLint({
    text: "If you do not miss me today, I will die before sunset.",
    fallbackText: fallback,
  });

  assert.equal(robotic.text, fallback);
  assert.ok(robotic.violations.includes("robotic_task_wording"));
  assert.equal(pressure.text, fallback);
  assert.ok(pressure.violations.includes("pressure_or_guilt_wording"));
  assert.equal(pidgin.text, fallback);
  assert.ok(pidgin.violations.includes("pidgin_wording"));
  assert.equal(coerciveFakeStake.text, fallback);
  assert.ok(coerciveFakeStake.violations.includes("coercive_fake_stakes"));
});
