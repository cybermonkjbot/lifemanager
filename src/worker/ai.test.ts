import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBossAddressEscalation,
  detectPidginSignal,
  detectOldEnglishSignal,
  describeInboundImageWithFallback,
  detectConversationSteeringMode,
  evaluateJokeGuardrail,
  evaluateCopyRisk,
  generateReplyWithFallback,
  hasAggressiveInsultCue,
  hasBossAddressCue,
  inferFriendshipGenerationCohort,
  inferProfessionalLinguaProfile,
  generateMemeImageWithAzure,
  normalizeOutboundText,
  postProcessReplyText,
  routeAckResponseChannel,
  sanitizeCommonPhrasesForPrompt,
} from "./ai";
import { getDefaultPersonaPack, getPersonaPackById, parsePersonaPackForTests, selectFewShotsForPrompt } from "../../convex/lib/personaPacks";

const ENV_KEYS = [
  "AZURE_AI_ENDPOINT",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_AI_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "AZURE_AI_MODEL",
  "AZURE_OPENAI_MODEL",
  "AZURE_AI_IMAGE_ENDPOINT",
  "AZURE_AI_IMAGE_API_KEY",
  "AZURE_AI_IMAGE_MODEL",
  "AZURE_AI_VIDEO_ENDPOINT",
  "AZURE_AI_VIDEO_API_KEY",
  "AZURE_AI_VIDEO_MODEL",
  "AZURE_OPENAI_VIDEO_ENDPOINT",
  "AZURE_OPENAI_VIDEO_API_KEY",
  "AZURE_OPENAI_VIDEO_MODEL",
  "AZURE_OPENAI_IMAGE_MODEL",
  "OPENAI_API_KEY",
  "CODEX_CLI_PATH",
] as const;

function clearAiEnv() {
  const snapshot: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};
  for (const key of ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      snapshot[key] = value;
    }
    delete process.env[key];
  }
  return snapshot;
}

function restoreAiEnv(snapshot: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test("normalizeOutboundText removes em dashes and normalizes punctuation spacing", () => {
  const input = "Hey — are you free – later…   ";
  const output = normalizeOutboundText(input);
  assert.equal(output, "Hey, are you free, later...");
});

test("normalizeOutboundText keeps line breaks while trimming", () => {
  const input = "  First line — test  \n  Second line  ";
  const output = normalizeOutboundText(input);
  assert.equal(output, "First line, test\nSecond line");
});

test("postProcessReplyText strips emojis and trims repeated direct-name addressing", () => {
  const output = postProcessReplyText({
    text: "Hey Alex, got it 😂. Alex, I will send it soon 😅",
    inboundText: "Can you send it?",
    theirName: "Alex Johnson",
  });
  assert.equal(output, "Hey, got it. I will send it soon");
});

test("postProcessReplyText can preserve emojis when enabled", () => {
  const output = postProcessReplyText({
    text: "All good 😂",
    inboundText: "Nice one",
    preserveEmojis: true,
  });
  assert.equal(output, "All good 😂");
});

test("postProcessReplyText keeps a single name mention when inbound explicitly uses it", () => {
  const output = postProcessReplyText({
    text: "Alex, I can sort this now.",
    inboundText: "Alex can you sort this now?",
    theirName: "Alex",
  });
  assert.equal(output, "Alex, I can sort this now.");
});

test("postProcessReplyText strips bare leading name when inbound does not use it", () => {
  const output = postProcessReplyText({
    text: "Alex I can sort this now.",
    inboundText: "Can you sort this now?",
    theirName: "Alex",
  });
  assert.equal(output, "I can sort this now.");
});

test("postProcessReplyText strips trailing direct-name address when inbound does not use it", () => {
  const output = postProcessReplyText({
    text: "I can sort this now, Alex.",
    inboundText: "Can you sort this now?",
    theirName: "Alex",
  });
  assert.equal(output, "I can sort this now.");
});

test("postProcessReplyText normalizes family terms in pidgin mode", () => {
  const output = postProcessReplyText({
    text: "My mum and dad will call later.",
    inboundText: "abeg no vex, I dey road",
    historyLines: ["Them: how far"],
  });
  assert.equal(output, "My Mama and Papa will call later.");
});

test("postProcessReplyText keeps family terms unchanged outside pidgin mode", () => {
  const output = postProcessReplyText({
    text: "My mum and dad will call later.",
    inboundText: "Can we talk this evening?",
    historyLines: ["Them: thanks for the update"],
  });
  assert.equal(output, "My mum and dad will call later.");
});

test("postProcessReplyText strips sales or stock claims", () => {
  const output = postProcessReplyText({
    text: "I have stock for this. We can chat later.",
    inboundText: "Are you around?",
    historyLines: [],
  });
  assert.equal(output, "We can chat later.");
});

test("postProcessReplyText falls back when reply is only a stock claim", () => {
  const output = postProcessReplyText({
    text: "I get small stock.",
    inboundText: "Are you online?",
    historyLines: [],
    fallbackText: "All good.",
  });
  assert.equal(output, "All good.");
});

test("postProcessReplyText strips gendered wording when gender is unknown", () => {
  const output = postProcessReplyText({
    text: "Thanks bro, you handled this well.",
    inboundText: "Can you check this now?",
    historyLines: [],
  });
  assert.equal(output, "Thanks, you handled this well.");
});

test("postProcessReplyText allows male-gendered wording when contact self-identifies as male", () => {
  const output = postProcessReplyText({
    text: "No wahala bro, I got you.",
    inboundText: "I'm a guy and I'm stuck on this.",
    historyLines: [],
  });
  assert.equal(output, "No wahala bro, I got you.");
});

test("postProcessReplyText allows female-gendered wording when contact self-identifies as female", () => {
  const output = postProcessReplyText({
    text: "You got this queen.",
    inboundText: "I'm a woman and I need help with this.",
    historyLines: [],
  });
  assert.equal(output, "You got this queen.");
});

test("postProcessReplyText allows king/queen in joke context when gender is unknown", () => {
  const output = postProcessReplyText({
    text: "lol relax king, you dey do too much.",
    inboundText: "haha you funny.",
    historyLines: [],
  });
  assert.equal(output, "lol relax king, you dey do too much.");
});

test("postProcessReplyText strips king/queen outside joke context when gender is unknown", () => {
  const output = postProcessReplyText({
    text: "Thanks queen, noted.",
    inboundText: "Please check this.",
    historyLines: [],
  });
  assert.equal(output, "Thanks, noted.");
});

test("postProcessReplyText rewrites self-care advice for health disclosures to empathy-only get-better wording", () => {
  const output = postProcessReplyText({
    text: "I am sorry that happened. Please take care of yourself and get some rest.",
    inboundText: "I had an accident earlier today.",
    historyLines: [],
  });
  assert.doesNotMatch(output, /\b(take care|rest(?: up)?|drink water|hydrate|meds?|doctor|hospital|clinic)\b/i);
  assert.match(output, /\b(i hope|hope)\b/i);
  assert.match(output, /\b(better|recover)\b/i);
});

test("postProcessReplyText keeps non-health take-care phrasing unchanged", () => {
  const output = postProcessReplyText({
    text: "Take care and talk soon.",
    inboundText: "Thanks for sorting this out.",
    historyLines: [],
  });
  assert.equal(output, "Take care and talk soon.");
});

test("postProcessReplyText strips AI-denial lines when AI was previously disclosed", () => {
  const output = postProcessReplyText({
    text: "I don't use any AI for this. I can check and get back.",
    inboundText: "Is that your AI helping again?",
    historyLines: ["Me: I have an AI assistant that works for me on replies."],
  });
  assert.equal(output, "I can check and get back.");
});

test("postProcessReplyText keeps AI-denial lines when no prior AI disclosure exists", () => {
  const output = postProcessReplyText({
    text: "I don't use any AI for this.",
    inboundText: "Who wrote this?",
    historyLines: [],
  });
  assert.equal(output, "I don't use any AI for this.");
});

test("postProcessReplyText enforces JADL disclosure when inbound asks if this is AI", () => {
  const output = postProcessReplyText({
    text: "No AI here, just me.",
    inboundText: "Are you an AI or a real person?",
    historyLines: [],
  });
  assert.match(output, /Joshua's digital liaison/i);
  assert.match(output, /conversational intelligence tool designed by Joshua/i);
  assert.match(output, /state-of-the-art AI/i);
  assert.match(output, /primary authority/i);
});

test("postProcessReplyText strips awkward catchphrase prefix while keeping core response", () => {
  const output = postProcessReplyText({
    text: "Kindly pardon me small, I can send the update now.",
    inboundText: "Can you send the update now?",
    historyLines: [],
  });
  assert.equal(output, "I can send the update now.");
});

test("postProcessReplyText enforces factual guardrail in self-roast mode for profile claims", () => {
  const output = postProcessReplyText({
    text: "No degree here, I dropped out at grade 8 after the famine.",
    inboundText: "Do you have a degree?",
    historyLines: [],
    selfRoastModeEnabled: true,
  });
  assert.equal(output, "I can roast myself for fun, but I keep profile facts accurate.");
});

test("postProcessReplyText does not apply self-roast factual guardrail when mode is disabled", () => {
  const output = postProcessReplyText({
    text: "No degree here, I dropped out at grade 8 after the famine.",
    inboundText: "Do you have a degree?",
    historyLines: [],
    selfRoastModeEnabled: false,
  });
  assert.equal(output, "No degree here, I dropped out at grade 8 after the famine.");
});

test("postProcessReplyText applies anti-calculator math tone for plain numeric replies", () => {
  const output = postProcessReplyText({
    text: "42",
    inboundText: "what is 40 + 2?",
    historyLines: [],
  });
  assert.match(output, /42/);
  assert.doesNotMatch(output, /^42[.!?]?$/);
  assert.doesNotMatch(output, /^(?:the answer is|it(?:'|’)s|it is|equals?)\s*42[.!?]?$/i);
  assert.match(output, /\b(i|my)\b/i);
});

test("postProcessReplyText does not apply anti-calculator tone for non-math inbound", () => {
  const output = postProcessReplyText({
    text: "42",
    inboundText: "my apartment number is 42",
    historyLines: [],
  });
  assert.equal(output, "42");
});

test("postProcessReplyText keeps existing anti-math hedge when already present", () => {
  const output = postProcessReplyText({
    text: "I wasn't very good at math but I think it's 42.",
    inboundText: "what is 40 + 2?",
    historyLines: [],
  });
  assert.equal(output, "I wasn't very good at math but I think it's 42.");
});

test("postProcessReplyText anti-calculator tone is deterministic per input", () => {
  const input = {
    text: "84",
    inboundText: "what's 12 * 7?",
    historyLines: [],
  };
  const a = postProcessReplyText(input);
  const b = postProcessReplyText(input);
  assert.equal(a, b);
});

test("postProcessReplyText anti-calculator tone handles answer-prefix replies", () => {
  const output = postProcessReplyText({
    text: "The answer is 16",
    inboundText: "calculate 8 + 8",
    historyLines: [],
  });
  assert.match(output, /16/);
  assert.doesNotMatch(output, /^the answer is 16[.!?]?$/i);
});

test("postProcessReplyText anti-calculator tone handles word-problem phrasing", () => {
  const output = postProcessReplyText({
    text: "15",
    inboundText: "what do you get when 24 minus 9?",
    historyLines: [],
  });
  assert.match(output, /15/);
  assert.doesNotMatch(output, /^15[.!?]?$/);
  assert.match(output, /\b(i|my)\b/i);
});

test("postProcessReplyText anti-calculator tone handles linear equation asks", () => {
  const output = postProcessReplyText({
    text: "3",
    inboundText: "solve 2x + 4 = 10",
    historyLines: [],
  });
  assert.match(output, /3/);
  assert.doesNotMatch(output, /^3[.!?]?$/);
});

test("postProcessReplyText rewrites puppet-style joke delivery into non-joke response", () => {
  const output = postProcessReplyText({
    text: "Why did the calendar get promoted? Because it had all the dates.",
    inboundText: "tell me a joke about deadline pressure",
    historyLines: [],
  });
  assert.doesNotMatch(output, /\bwhy did\b|\bknock knock\b/i);
  assert.match(output, /\bdeadline\b|\bpressure\b|\bthis\b/i);
});

test("postProcessReplyText strips follow-up questions in steering close modes", () => {
  const output = postProcessReplyText({
    text: "Sure, what time should I text you?",
    inboundText: "I'm driving rn, talk later",
    historyLines: [],
  });
  assert.equal(output.includes("?"), false);
});

test("postProcessReplyText strips close-mode reopen cues even without question marks", () => {
  const output = postProcessReplyText({
    text: "All good, let me know what you think.",
    inboundText: "Thanks, all good.",
    historyLines: [],
  });
  assert.doesNotMatch(output, /\blet me know\b/i);
  assert.doesNotMatch(output, /\bwhat you think\b/i);
});

test("hasBossAddressCue detects vocative boss forms and ignores plain references", () => {
  assert.equal(hasBossAddressCue("Boss, can you send the update?"), true);
  assert.equal(hasBossAddressCue("Hi oga please check this."), true);
  assert.equal(hasBossAddressCue("My boss asked for the report."), false);
});

test("applyBossAddressEscalation prefixes upgraded title when inbound uses boss vocative", () => {
  const output = applyBossAddressEscalation({
    inboundText: "Boss can you send this now?",
    replyText: "I can send it now.",
  });
  assert.match(output, /, I can send it now\.$/);
  assert.ok(/\bboss\b|\bchairman\b|\boga\b/i.test(output));
});

test("postProcessReplyText applies boss escalation in normal flows but skips hard stop", () => {
  const regular = postProcessReplyText({
    text: "I can sort this now.",
    inboundText: "Boss, can you sort this now?",
    historyLines: [],
  });
  assert.match(regular, /, I can sort this now\.$/);
  assert.ok(/\bboss\b|\bchairman\b|\boga\b/i.test(regular));

  const hardStop = postProcessReplyText({
    text: "Understood. I'll leave it here.",
    inboundText: "Boss stop texting me.",
    historyLines: [],
  });
  assert.equal(hardStop, "Understood. I'll leave it here.");
});

test("sanitizeCommonPhrasesForPrompt drops awkward catchphrases and keeps useful phrases", () => {
  const result = sanitizeCommonPhrasesForPrompt([
    "abeg me small",
    "Kindly pardon me",
    "forgive me small",
    "circle back soon",
    "let me check",
    "send invoice summary",
    "appreciate the quick heads-up",
  ]);

  assert.deepEqual(result, ["send invoice summary", "appreciate the quick heads-up"]);
});

test("sanitizeCommonPhrasesForPrompt drops courtesy-imperative mimicry phrases", () => {
  const result = sanitizeCommonPhrasesForPrompt([
    "Kindly allow me",
    "please just allow me small",
    "tight timeline recap",
  ]);

  assert.deepEqual(result, ["tight timeline recap"]);
});

test("sanitizeCommonPhrasesForPrompt drops sensitive or over-specific mimicry phrases", () => {
  const result = sanitizeCommonPhrasesForPrompt([
    "Use this OTP 839102",
    "my bank account is 0123456789",
    "https://example.com/checkout",
    "my signature line right here forever and always",
    "tight timeline, send the clean recap",
  ]);

  assert.deepEqual(result, ["tight timeline, send the clean recap"]);
});

test("evaluateJokeGuardrail blocks similar jokes already sent in chat history", () => {
  const result = evaluateJokeGuardrail("LOL I run on coffee and chaos before noon.", [
    "Them: Morning, how are you?",
    "Me: Haha I run on coffee and chaos before noon.",
  ]);
  assert.equal(result.blocked, true);
  assert.match(result.reason, /similar joke/i);
});

test("evaluateCopyRisk blocks replies that copy inbound wording verbatim", () => {
  const result = evaluateCopyRisk({
    replyText: "Please send the Q4 invoice summary by 3pm today.",
    inboundText: "Please send the Q4 invoice summary by 3pm today.",
    historyLines: [],
  });
  assert.equal(result.blocked, true);
  assert.match(result.reason, /verbatim|copies/i);
});

test("evaluateCopyRisk allows paraphrased replies that keep intent but change wording", () => {
  const result = evaluateCopyRisk({
    replyText: "I can share the Q4 invoice recap before 3pm.",
    inboundText: "Please send the Q4 invoice summary by 3pm today.",
    historyLines: [],
  });
  assert.equal(result.blocked, false);
});

test("evaluateJokeGuardrail blocks cringe joke patterns", () => {
  const result = evaluateJokeGuardrail("Knock knock. Who's there? Skibidi rizz.");
  assert.equal(result.blocked, true);
  assert.match(result.reason, /cringe/i);
});

test("evaluateJokeGuardrail allows playful lines that are fresh and non-cringe", () => {
  const result = evaluateJokeGuardrail("Haha your timing is elite, that update landed right on cue.", [
    "Me: Thanks, I sent the file earlier.",
  ]);
  assert.equal(result.blocked, false);
});

test("evaluateJokeGuardrail blocks joke-chain stretching when a recent outbound joke exists", () => {
  const result = evaluateJokeGuardrail("Haha I deserve MVP for surviving this chaos today.", [
    "Them: Did you finish the notes?",
    "Me: haha this week is pure chaos 😂",
    "Them: lmao",
    "Me: I still sent the report already.",
  ]);
  assert.equal(result.blocked, true);
  assert.match(result.reason, /last 2 outbound replies/i);
});

test("evaluateJokeGuardrail allows jokes when prior humor is outside cooldown window", () => {
  const result = evaluateJokeGuardrail("Haha I need a trophy for that timing.", [
    "Me: lol this sprint humbled me",
    "Them: haha",
    "Me: I sent the timeline and budget.",
    "Them: got it",
    "Me: Let me know if anything is missing.",
  ]);
  assert.equal(result.blocked, false);
});

test("evaluateJokeGuardrail blocks jokes when inbound context is not playful enough", () => {
  const result = evaluateJokeGuardrail(
    "Haha this deadline is doing MMA with me.",
    ["Them: Can you send the invoice summary now?", "Me: I can share in 10 minutes."],
    {
      inboundText: "Can you send the invoice summary now?",
    },
  );
  assert.equal(result.blocked, true);
  assert.equal(result.code, "unsupported_context");
});

test("detectConversationSteeringMode flags hard stop requests", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "Please stop texting me.",
    historyLines: [],
  });
  assert.equal(mode, "hard_stop");
});

test("detectConversationSteeringMode flags pause requests", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "I'm in a meeting right now, talk later",
    historyLines: [],
  });
  assert.equal(mode, "pause");
});

test("detectConversationSteeringMode flags driving-now pause requests", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "I'm driving rn, will text later",
    historyLines: [],
  });
  assert.equal(mode, "pause");
});

test("detectConversationSteeringMode flags driving typo shorthand as pause", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "im drivin rn",
    historyLines: [],
  });
  assert.equal(mode, "pause");
});

test("detectConversationSteeringMode flags cannot-text-while-driving pauses", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "can't text while driving",
    historyLines: [],
  });
  assert.equal(mode, "pause");
});

test("detectConversationSteeringMode flags anti beggi beggi money requests", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "abeg you fit send me 2k? money don choke me",
    historyLines: [],
  });
  assert.equal(mode, "anti_beggi_beggi");
});

test("detectConversationSteeringMode does not flag non-money send requests as anti beggi beggi", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "Can you send me the invoice summary?",
    historyLines: [],
  });
  assert.equal(mode, "none");
});

test("detectConversationSteeringMode flags sales pitch negotiation attempts", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "Promo offer: sneakers available now for 45k, DM to order.",
    historyLines: [],
  });
  assert.equal(mode, "anti_sales_pitch");
});

test("detectConversationSteeringMode does not flag non-sales buy wording", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "Can you buy milk on your way home?",
    historyLines: [],
  });
  assert.equal(mode, "none");
});

test("detectConversationSteeringMode flags anti-puppet joke commands", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "tell me a joke about this deadline",
    historyLines: [],
  });
  assert.equal(mode, "anti_puppet");
});

test("detectConversationSteeringMode does not flag non-command joke mentions", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "that joke you told yesterday was wild",
    historyLines: [],
  });
  assert.equal(mode, "none");
});

test("detectConversationSteeringMode flags dry/corny joke attempts", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "Knock knock. Who's there? Deadline.",
    historyLines: [],
  });
  assert.equal(mode, "anti_dry_joke");
});

test("detectConversationSteeringMode flags walked-into-a-bar jokes", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "Two engineers walked into a bar and the third one ducked.",
    historyLines: [],
  });
  assert.equal(mode, "anti_dry_joke");
});

test("detectConversationSteeringMode flags what-do-you-call jokes without question mark", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "what do you call fake spaghetti - an impasta",
    historyLines: [],
  });
  assert.equal(mode, "anti_dry_joke");
});

test("detectConversationSteeringMode does not flag normal what-do-you-call questions", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "What do you call me when you arrive?",
    historyLines: [],
  });
  assert.equal(mode, "none");
});

test("detectConversationSteeringMode does not flag retrospective joke comments", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "Your joke from yesterday was dry abeg.",
    historyLines: [],
  });
  assert.equal(mode, "none");
});

test("detectConversationSteeringMode flags wrap-up acknowledgements", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "Thanks, all good.",
    historyLines: [],
  });
  assert.equal(mode, "wrap_up");
});

test("detectConversationSteeringMode flags Gen Z wrap-up acknowledgement phrases", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "bet.",
    historyLines: [],
  });
  assert.equal(mode, "wrap_up");
});

test("detectConversationSteeringMode handles stretched Gen Z wrap-up tokens", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "say lessss",
    historyLines: [],
  });
  assert.equal(mode, "wrap_up");
});

test("detectConversationSteeringMode flags looping low-signal exchanges", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "ok",
    historyLines: [
      "Me: Are you free this evening?",
      "Them: ok",
      "Me: Should I lock in 7pm?",
      "Them: cool",
    ],
  });
  assert.equal(mode, "loop");
});

test("detectConversationSteeringMode flags looping Gen Z acknowledgements", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "kk",
    historyLines: [
      "Me: You still want me to send the updated notes?",
      "Them: bet",
      "Me: Should I share before lunch?",
      "Them: kk",
    ],
  });
  assert.equal(mode, "loop");
});

test("detectConversationSteeringMode flags Gen Z pause requests", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "afk rn, hmu later",
    historyLines: [],
  });
  assert.equal(mode, "pause");
});

test("detectConversationSteeringMode flags busy-rn shorthand pauses", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "busy rn",
    historyLines: [],
  });
  assert.equal(mode, "pause");
});

test("detectConversationSteeringMode flags code-switched continue-later pause", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "make we continue later",
    historyLines: [],
  });
  assert.equal(mode, "pause");
});

test("detectConversationSteeringMode flags pidgin call-later pause", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "make i call you later",
    historyLines: [],
  });
  assert.equal(mode, "pause");
});

test("detectConversationSteeringMode flags pidgin road status as pause", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "i dey road rn",
    historyLines: [],
  });
  assert.equal(mode, "pause");
});

test("detectConversationSteeringMode flags colloquial hard stop requests", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "don't hit me up again.",
    historyLines: [],
  });
  assert.equal(mode, "hard_stop");
});

test("detectConversationSteeringMode flags pidgin hard stop requests", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "abeg no text me again",
    historyLines: [],
  });
  assert.equal(mode, "hard_stop");
});

test("detectConversationSteeringMode flags pidgin hard stop no-disturb variants", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "abeg no disturb me again",
    historyLines: [],
  });
  assert.equal(mode, "hard_stop");
});

test("detectConversationSteeringMode does not treat plain insults as hard stop", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "you are stupid",
    historyLines: [],
  });
  assert.equal(mode, "none");
});

test("hasAggressiveInsultCue detects direct aggressive insults", () => {
  assert.equal(hasAggressiveInsultCue("You are useless and stupid."), true);
  assert.equal(hasAggressiveInsultCue("abeg mumu, rest"), true);
  assert.equal(hasAggressiveInsultCue("wtf is wrong with you"), true);
});

test("hasAggressiveInsultCue ignores normal frustration language", () => {
  assert.equal(hasAggressiveInsultCue("This week was stressful and weird."), false);
  assert.equal(hasAggressiveInsultCue("I'm frustrated with this delay."), false);
});

test("detectConversationSteeringMode treats social acknowledgement tails as wrap-up", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "thx bro",
    historyLines: [],
  });
  assert.equal(mode, "wrap_up");
});

test("detectConversationSteeringMode treats code-switched wrap-up phrases as wrap-up", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "all good sha",
    historyLines: [],
  });
  assert.equal(mode, "wrap_up");
});

test("detectConversationSteeringMode handles typo shorthand wrap-up tokens", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "okkk",
    historyLines: [],
  });
  assert.equal(mode, "wrap_up");
});

test("detectConversationSteeringMode handles typo thank-you wrap-up tokens", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "tnx",
    historyLines: [],
  });
  assert.equal(mode, "wrap_up");
});

test("detectConversationSteeringMode handles all-gud typo wrap-up", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "all gud",
    historyLines: [],
  });
  assert.equal(mode, "wrap_up");
});

test("detectConversationSteeringMode handles na-so wrap-up", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "na so",
    historyLines: [],
  });
  assert.equal(mode, "wrap_up");
});

test("detectConversationSteeringMode handles typo pidgin pause variants", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "i dey wrk rn",
    historyLines: [],
  });
  assert.equal(mode, "pause");
});

test("detectPidginSignal detects Naija/Pidgin phrasing from inbound text", () => {
  const signal = detectPidginSignal({
    inboundText: "abeg no vex, make we yarn later",
    historyLines: [],
  });
  assert.equal(signal, true);
});

test("detectPidginSignal detects Naija/Pidgin phrasing from recent history", () => {
  const signal = detectPidginSignal({
    inboundText: "let's continue tomorrow",
    historyLines: ["Them: how far", "Me: we dey outside now"],
  });
  assert.equal(signal, true);
});

test("detectPidginSignal stays off for plain English conversations", () => {
  const signal = detectPidginSignal({
    inboundText: "Can we continue this tomorrow morning?",
    historyLines: ["Them: Thanks for the update", "Me: Sure, I will send it by 10."],
  });
  assert.equal(signal, false);
});

test("detectPidginSignal catches broader pidgin tokens from inbound text", () => {
  const signal = detectPidginSignal({
    inboundText: "wetin dey sup? no wahala, I don dey come",
    historyLines: [],
  });
  assert.equal(signal, true);
});

test("detectPidginSignal catches broader pidgin tokens from history context", () => {
  const signal = detectPidginSignal({
    inboundText: "See you later",
    historyLines: ["Them: no wahala", "Me: I fit run am, padi"],
  });
  assert.equal(signal, true);
});

test("detectPidginSignal catches commot/tori variants", () => {
  const signal = detectPidginSignal({
    inboundText: "make I commot now, I go yarn you the tori later",
    historyLines: [],
  });
  assert.equal(signal, true);
});

test("detectPidginSignal does not trigger on weak family-token-only text", () => {
  const signal = detectPidginSignal({
    inboundText: "Mama and Papa are around",
    historyLines: [],
  });
  assert.equal(signal, false);
});

test("detectOldEnglishSignal detects archaic phrasing from inbound text", () => {
  const signal = detectOldEnglishSignal({
    inboundText: "Thou art kind; canst thou send it anon?",
    historyLines: [],
  });
  assert.equal(signal, true);
});

test("detectOldEnglishSignal detects archaic phrasing from recent history", () => {
  const signal = detectOldEnglishSignal({
    inboundText: "Can you send that update later?",
    historyLines: ["Them: good morrow", "Me: I shall send it anon."],
  });
  assert.equal(signal, true);
});

test("detectOldEnglishSignal stays off for modern plain English", () => {
  const signal = detectOldEnglishSignal({
    inboundText: "Can you send the update later today?",
    historyLines: ["Them: thanks for the quick update", "Me: sure, I will send it by 4pm"],
  });
  assert.equal(signal, false);
});

test("postProcessReplyText lightly mirrors old-English tone when conversation uses it", () => {
  const output = postProcessReplyText({
    text: "Understood. I will send it shortly.",
    inboundText: "Thou art kind; canst thou send it anon?",
    historyLines: [],
  });
  assert.equal(output, "Aye, Understood. I will send it shortly.");
});

test("evaluateJokeGuardrail allows common slang that is not forced meme humor", () => {
  const result = evaluateJokeGuardrail("lol no cap your timing was elite", [
    "Me: I sent the first draft this morning.",
  ]);
  assert.equal(result.blocked, false);
});

test("describeInboundImageWithFallback returns heuristic fallback when Azure config is missing", async () => {
  const snapshot = clearAiEnv();

  try {
    const result = await describeInboundImageWithFallback({
      imageBytes: Buffer.from("fake-image"),
      caption: "wild status",
      mimeType: "image/jpeg",
    });
    assert.equal(result.provider, "heuristic");
    assert.match(result.description, /wild status/i);
    assert.match(result.error || "", /endpoint\/key missing/i);
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("generateMemeImageWithAzure retries with slimmer payload on unknown parameter errors", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  const seenBodies: Array<Record<string, unknown>> = [];

  try {
    process.env.AZURE_AI_IMAGE_ENDPOINT = "https://example.services.ai.azure.com/openai/v1/images/generations";
    process.env.AZURE_AI_IMAGE_API_KEY = "test-key";
    process.env.AZURE_AI_IMAGE_MODEL = "gpt-image-1.5";

    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      seenBodies.push(body);
      if (seenBodies.length === 1) {
        return new Response(
          JSON.stringify({
            error: {
              message: "Unknown parameter: 'quality'.",
              param: "quality",
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          data: [
            {
              b64_json: Buffer.from("meme-ok").toString("base64"),
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await generateMemeImageWithAzure({
      inboundText: "Make a meme about late replies",
      recentHistoryLines: ["Them: you still dey there?", "Me: yes o"],
      threadTitle: "Sample chat",
    });

    assert.equal(result.error, undefined);
    assert.ok(result.imageBytes);
    assert.equal(result.imageBytes?.toString("utf8"), "meme-ok");
    assert.equal(seenBodies.length, 2);
    assert.equal(typeof seenBodies[0]?.quality, "string");
    assert.equal(seenBodies[1]?.quality, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateMemeImageWithAzure maps bare Foundry target URI and defaults to image model", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  const calledUrls: string[] = [];

  try {
    process.env.AZURE_AI_IMAGE_ENDPOINT = "https://cribnoshprod-resource.services.ai.azure.com";
    process.env.AZURE_AI_IMAGE_API_KEY = "test-key";
    process.env.AZURE_AI_MODEL = "gpt-5.4";
    delete process.env.AZURE_AI_IMAGE_MODEL;

    globalThis.fetch = (async (input, init) => {
      calledUrls.push(String(input));
      const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      assert.equal(body.model, "gpt-image-1");
      return new Response(
        JSON.stringify({
          data: [
            {
              b64_json: Buffer.from("ok").toString("base64"),
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await generateMemeImageWithAzure({
      inboundText: "Make a witty meme",
      recentHistoryLines: [],
    });

    assert.equal(result.error, undefined);
    assert.equal(result.model, "gpt-image-1");
    assert.equal(calledUrls.length > 0, true);
    assert.match(calledUrls[0] || "", /\/openai\/v1\/images\/generations$/i);
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateMemeImageWithAzure can generate video meme payloads when preferVideo is enabled", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  const calledUrls: string[] = [];

  try {
    process.env.AZURE_AI_VIDEO_ENDPOINT = "https://example.services.ai.azure.com";
    process.env.AZURE_AI_VIDEO_API_KEY = "video-key";
    process.env.AZURE_AI_VIDEO_MODEL = "gpt-video-1";

    globalThis.fetch = (async (input, init) => {
      calledUrls.push(String(input));
      if (calledUrls.length === 1) {
        const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
        assert.equal(body.model, "gpt-video-1");
        assert.equal(body.seconds, "4");
        return new Response(
          JSON.stringify({ id: "video_test_123", status: "queued" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (calledUrls.length === 2) {
        return new Response(
          JSON.stringify({ id: "video_test_123", status: "completed" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(Buffer.from("video-ok"), {
        status: 200,
        headers: { "content-type": "video/mp4" },
      });
    }) as typeof fetch;

    const result = await generateMemeImageWithAzure({
      inboundText: "make a meme clip for this gist",
      recentHistoryLines: ["Them: this one needs motion", "Me: facts"],
      preferVideo: true,
    });

    assert.equal(result.error, undefined);
    assert.equal(result.model, "gpt-video-1");
    assert.equal(result.mimeType, "video/mp4");
    assert.equal(result.imageBytes?.toString("utf8"), "video-ok");
    assert.equal(calledUrls.length, 3);
    assert.match(calledUrls[0] || "", /\/openai\/v1\/videos$/i);
    assert.match(calledUrls[1] || "", /\/openai\/v1\/videos\/video_test_123$/i);
    assert.match(calledUrls[2] || "", /\/openai\/v1\/videos\/video_test_123\/content$/i);
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback short-circuits wrap-up messages locally", async () => {
  const snapshot = clearAiEnv();

  try {
    const result = await generateReplyWithFallback({
      inboundText: "Thanks, all good.",
      historyLines: ["Me: Sent details earlier."],
      styleHints: [],
    });

    assert.equal(result.provider, "heuristic");
    assert.equal(result.model, "heuristic-local-wrap_up");
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0]?.stage, "heuristic_fallback");
    assert.ok(Array.isArray(result.contextToolCalls));
    assert.ok(result.contextToolCalls && result.contextToolCalls.some((call) => call.name === "context_window_cleaning"));
    assert.ok(result.contextToolCalls && result.contextToolCalls.some((call) => call.name === "conversation_history_search"));
    assert.ok(result.contextToolCalls && result.contextToolCalls.some((call) => call.name === "context_window_detection"));
    assert.ok(result.contextWindow);
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback in model-first mode routes pause/loop/wrap_up through model path", async () => {
  const snapshot = clearAiEnv();

  try {
    const cases: Array<{ mode: "pause" | "loop" | "wrap_up"; inboundText: string; historyLines: string[] }> = [
      {
        mode: "pause",
        inboundText: "I'm driving rn, will text later",
        historyLines: [],
      },
      {
        mode: "loop",
        inboundText: "ok",
        historyLines: [
          "Me: Are you free this evening?",
          "Them: ok",
          "Me: Should I lock in 7pm?",
          "Them: cool",
        ],
      },
      {
        mode: "wrap_up",
        inboundText: "Thanks, all good.",
        historyLines: ["Me: Sent details earlier."],
      },
    ];

    for (const item of cases) {
      const result = await generateReplyWithFallback({
        inboundText: item.inboundText,
        historyLines: item.historyLines,
        styleHints: [],
        runtime: {
          modelFirstEnabled: true,
          fallbackMode: "azure_only",
        },
      });
      assert.equal(result.provider, "azure");
      assert.equal(result.guardrailBlocked, true);
      assert.equal(result.model, "gpt-5.4");
      assert.equal(result.attempts.some((attempt) => attempt.model === `heuristic-local-${item.mode}`), false);
    }
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback in model-first mode still keeps hard-stop deterministic bypass", async () => {
  const snapshot = clearAiEnv();

  try {
    const result = await generateReplyWithFallback({
      inboundText: "please stop texting me",
      historyLines: [],
      styleHints: [],
      runtime: {
        modelFirstEnabled: true,
        fallbackMode: "azure_only",
      },
    });

    assert.equal(result.provider, "heuristic");
    assert.equal(result.model, "heuristic-local-hard_stop");
    assert.equal(result.attempts[0]?.stage, "heuristic_fallback");
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback honors custom deterministic mode list in model-first mode", async () => {
  const snapshot = clearAiEnv();

  try {
    const result = await generateReplyWithFallback({
      inboundText: "I'm in a meeting right now, talk later",
      historyLines: [],
      styleHints: [],
      runtime: {
        modelFirstEnabled: true,
        deterministicModes: ["hard_stop", "anti_beggi_beggi", "anti_sales_pitch", "pause"],
        fallbackMode: "azure_only",
      },
    });

    assert.equal(result.provider, "heuristic");
    assert.equal(result.model, "heuristic-local-pause");
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("routeAckResponseChannel returns reaction_plus_text when model router says so", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ output_text: '{"channel":"reaction_plus_text","reason":"warm acknowledgment"}' }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const routed = await routeAckResponseChannel({
      inboundText: "thanks",
      historyLines: ["Them: Sent the file", "Me: Nice one"],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
      },
    });

    assert.equal(routed.channel, "reaction_plus_text");
    assert.equal(routed.provider, "azure");
    assert.equal(routed.attempts[0]?.stage, "ack_router_azure");
    assert.equal(routed.attempts[0]?.status, "success");
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("routeAckResponseChannel returns undefined channel when router output is invalid", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ output_text: '{"channel":"unknown"}' }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const routed = await routeAckResponseChannel({
      inboundText: "ok",
      historyLines: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
      },
    });

    assert.equal(routed.channel, undefined);
    assert.equal(routed.attempts.some((attempt) => attempt.stage === "ack_router_azure" && attempt.status === "error"), true);
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback short-circuits anti beggi beggi money requests locally", async () => {
  const snapshot = clearAiEnv();

  try {
    const result = await generateReplyWithFallback({
      inboundText: "abeg you fit send me 2k?",
      historyLines: ["Me: I sent update earlier."],
      styleHints: [],
    });

    assert.equal(result.provider, "heuristic");
    assert.equal(result.model, "heuristic-local-anti_beggi_beggi");
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0]?.stage, "heuristic_fallback");
    assert.match(result.text, /money tight|no fit send|cannot send/i);
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback auto-selects firm anti beggi beggi tone for urgent requests", async () => {
  const snapshot = clearAiEnv();

  try {
    const result = await generateReplyWithFallback({
      inboundText: "Can you transfer me 10k urgently please? I need it now now.",
      historyLines: [],
      styleHints: [],
    });

    assert.equal(result.provider, "heuristic");
    assert.equal(result.model, "heuristic-local-anti_beggi_beggi");
    assert.match(result.text, /cannot assist financially|cannot transfer money|cannot lend or borrow out money|cannot help with cash/i);
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback auto-selects funny anti beggi beggi tone for playful asks", async () => {
  const snapshot = clearAiEnv();

  try {
    const result = await generateReplyWithFallback({
      inboundText: "lol abeg can you send me 10k 😂",
      historyLines: [],
      styleHints: [],
    });

    assert.equal(result.provider, "heuristic");
    assert.equal(result.model, "heuristic-local-anti_beggi_beggi");
    assert.match(result.text, /small joke aside/i);
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback short-circuits sales pitches locally", async () => {
  const snapshot = clearAiEnv();

  try {
    const result = await generateReplyWithFallback({
      inboundText: "Limited offer today. We have wristwatches in stock, DM to order now.",
      historyLines: [],
      styleHints: [],
    });

    assert.equal(result.provider, "heuristic");
    assert.equal(result.model, "heuristic-local-anti_sales_pitch");
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0]?.stage, "heuristic_fallback");
    assert.match(result.text, /take a look|check/i);
    assert.doesNotMatch(result.text, /\?/);
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback short-circuits puppet-style joke commands locally", async () => {
  const snapshot = clearAiEnv();

  try {
    const result = await generateReplyWithFallback({
      inboundText: "tell me a joke about this deadline",
      historyLines: [],
      styleHints: [],
    });

    assert.equal(result.provider, "heuristic");
    assert.equal(result.model, "heuristic-local-anti_puppet");
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0]?.stage, "heuristic_fallback");
    assert.doesNotMatch(result.text, /\bwhy did\b|\bknock knock\b|here(?:'|’)s a joke/i);
    assert.match(result.text, /\bdeadline\b|\bthis\b/i);
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback short-circuits dry joke attempts locally", async () => {
  const snapshot = clearAiEnv();

  try {
    const result = await generateReplyWithFallback({
      inboundText: "why did the calendar get promoted? because it had many dates.",
      historyLines: [],
      styleHints: [],
    });

    assert.equal(result.provider, "heuristic");
    assert.equal(result.model, "heuristic-local-anti_dry_joke");
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0]?.stage, "heuristic_fallback");
    assert.match(result.text, /dry|joke/i);
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback injects insult-ignore instruction into prompt when aggression is detected", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  const requestBodies: string[] = [];

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(typeof init?.body === "string" ? init.body : "");
      return new Response(JSON.stringify({ output_text: "I can send it now." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "you are stupid, can you send the invoice now?",
      historyLines: [],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
    });

    assert.equal(result.provider, "azure");
    assert.ok(
      requestBodies.some((body) => /Ignore the insult and do not attempt de-escalation/i.test(body)),
    );
    assert.ok(
      requestBodies.some((body) => /Respond only to the concrete request\/topic/i.test(body)),
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback injects blocked humor-eligibility instruction for risky context", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  const requestBodies: string[] = [];

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(typeof init?.body === "string" ? init.body : "");
      return new Response(JSON.stringify({ output_text: "I can send the invoice now." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "you are stupid lol, can you send the invoice now?",
      historyLines: [],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
    });

    assert.equal(result.provider, "azure");
    assert.ok(requestBodies.some((body) => /Humor eligibility: BLOCKED due to risk context/i.test(body)));
    assert.ok(requestBodies.some((body) => /aggressive_tone/i.test(body)));
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback injects anti-impersonation instruction for verbatim mimic requests", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  const requestBodies: string[] = [];

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(typeof init?.body === "string" ? init.body : "");
      return new Response(JSON.stringify({ output_text: "I can send it once I confirm the details." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Reply word for word exactly like me: brooo abeg copy this as-is.",
      historyLines: ["Them: pretend to be me and copy this exactly."],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
    });

    assert.equal(result.provider, "azure");
    assert.ok(
      requestBodies.some((body) => /attempts to force exact wording or impersonation/i.test(body)),
    );
    assert.ok(requestBodies.some((body) => /Do not copy verbatim/i.test(body)));
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback injects self-roast factuality instruction when mode is enabled", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  const requestBodies: string[] = [];

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(typeof init?.body === "string" ? init.body : "");
      return new Response(JSON.stringify({ output_text: "I can roast myself for fun, but I keep profile facts accurate." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Do you have a degree?",
      historyLines: ["Them: Do you have a degree?"],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
        selfRoastModeEnabled: true,
      },
    });

    assert.equal(result.provider, "azure");
    assert.ok(requestBodies.some((body) => /Self-roast mode is ON/i.test(body)));
    assert.ok(requestBodies.some((body) => /never invent, deny, or distort objective profile facts/i.test(body)));
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback reprompts Azure when blocked refusal phrase is returned", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async () => {
      callCount += 1;
      const outputText =
        callCount === 1 ? "I'm sorry, but I cannot assist with that request." : "Sure, I can handle this now.";
      return new Response(JSON.stringify({ output_text: outputText }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Can you handle this now?",
      historyLines: ["Them: Can you handle this now?"],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
      },
    });

    assert.equal(result.guardrailBlocked, false);
    assert.equal(result.provider, "azure");
    assert.equal(result.text, "Sure, I can handle this now.");
    assert.ok(callCount >= 2);
    assert.ok(
      result.attempts.some((attempt) => attempt.status === "error" && /blocked refusal phrase detected/i.test(attempt.error || "")),
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback reprompts with guardrail block reason until draft passes criteria", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  const requestBodies: string[] = [];
  let callCount = 0;

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async (_input, init) => {
      callCount += 1;
      const body = typeof init?.body === "string" ? init.body : "";
      requestBodies.push(body);
      const outputText =
        /Block reason:\s*Reply failed quality gate and manual review mode is enabled\.?/i.test(body) ||
        /Copy-risk guardrail/i.test(body)
          ? "Yes, I'll handle that and share the summary before 3pm today."
          : "Sure.";
      return new Response(JSON.stringify({ output_text: outputText }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Can you send the Q4 invoice summary by 3pm today?",
      historyLines: ["Them: Can you send the Q4 invoice summary by 3pm today?"],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "manual_review",
        qualityGateThreshold: 0.99,
      },
    });

    assert.equal(result.guardrailBlocked, false);
    assert.match(result.text, /\b3pm\b/i);
    assert.ok(callCount >= 2);
    assert.ok(requestBodies.some((body) => /Retry 1: Previous draft was blocked by system checks\./i.test(body)));
    assert.ok(
      requestBodies.some((body) => /Block reason:\s*Reply failed quality gate and manual review mode is enabled\./i.test(body)),
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback rewrites copy-risk drafts into paraphrased wording", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  let generationCalls = 0;

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async (_input, init) => {
      const bodyText = typeof init?.body === "string" ? init.body : "";
      generationCalls += 1;
      if (/Copy-risk guardrail/i.test(bodyText)) {
        return new Response(JSON.stringify({ output_text: "I can send that recap before 3pm." }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ output_text: "Please send the Q4 invoice summary by 3pm today." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Please send the Q4 invoice summary by 3pm today.",
      historyLines: ["Them: Please send the Q4 invoice summary by 3pm today."],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
    });

    assert.equal(result.guardrailBlocked, false);
    assert.equal(result.text, "I can send that recap before 3pm.");
    assert.ok(generationCalls >= 2);
    assert.equal(evaluateCopyRisk({
      replyText: result.text,
      inboundText: "Please send the Q4 invoice summary by 3pm today.",
      historyLines: [],
    }).blocked, false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback sends manual review when copy-risk rewrite still copies inbound text", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  let generationCalls = 0;

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async () => {
      generationCalls += 1;
      return new Response(JSON.stringify({ output_text: "Please send the Q4 invoice summary by 3pm today." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Please send the Q4 invoice summary by 3pm today.",
      historyLines: ["Them: Please send the Q4 invoice summary by 3pm today."],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "manual_review",
      },
    });

    assert.equal(result.guardrailBlocked, true);
    assert.match(result.guardrailReason || "", /copy-risk rewrite still violated guardrail/i);
    assert.ok(generationCalls >= 2);
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback blocks humor draft when AI humor judge says not funny", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async (_input, init) => {
      const bodyText = typeof init?.body === "string" ? init.body : "";
      const isHumorJudgeCall = /strict humor classifier|Candidate reply/i.test(bodyText);
      if (!isHumorJudgeCall) {
        return new Response(JSON.stringify({ output_text: "Haha I am a walking Monday bug report." }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          output_text: '{"isJokeAttempt":true,"isFunny":false,"confidence":0.91,"reason":"forced punchline"}',
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "How are you this morning?",
      historyLines: ["Them: How are you this morning?"],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
    });

    assert.equal(result.guardrailBlocked, true);
    assert.match(result.guardrailReason || "", /not funny/i);
    assert.ok(result.attempts.some((attempt) => attempt.stage === "humor_judge_azure" && attempt.status === "success"));
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback skips joke similarity matching when AI humor judge says draft is not a joke", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async (_input, init) => {
      const bodyText = typeof init?.body === "string" ? init.body : "";
      const isHumorJudgeCall = /strict humor classifier|Candidate reply/i.test(bodyText);
      if (!isHumorJudgeCall) {
        return new Response(JSON.stringify({ output_text: "lol no cap your timing was elite" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          output_text: '{"isJokeAttempt":false,"isFunny":false,"confidence":0.86,"reason":"not intended as a joke"}',
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Can you follow up now?",
      historyLines: [
        "Them: Can you follow up now?",
        "Me: lol no cap your timing was elite",
      ],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
    });

    assert.equal(result.guardrailBlocked, false);
    assert.equal(result.text, "lol no cap your timing was elite");
    assert.ok(result.attempts.some((attempt) => attempt.stage === "humor_judge_azure" && attempt.status === "success"));
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback rewrites humor when inbound context is not playful", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  let generationCalls = 0;
  try {
    globalThis.fetch = (async (_input, init) => {
      const bodyText = typeof init?.body === "string" ? init.body : "";
      const isHumorJudgeCall = /strict humor classifier|Candidate reply/i.test(bodyText);
      if (isHumorJudgeCall) {
        if (bodyText.includes("I can send the update in 10 minutes.")) {
          return new Response(
            JSON.stringify({
              output_text: '{"isJokeAttempt":false,"isFunny":false,"confidence":0.9,"reason":"direct reply"}',
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response(
          JSON.stringify({
            output_text: '{"isJokeAttempt":true,"isFunny":true,"confidence":0.88,"reason":"playful and natural"}',
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      generationCalls += 1;
      if (
        /Inbound context is not strongly playful enough to justify humor|Humor is disallowed because playful context is weak/i.test(
          bodyText,
        )
      ) {
        return new Response(JSON.stringify({ output_text: "I can send the update in 10 minutes." }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ output_text: "Haha this update is pure cinema today." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Can you send the update now?",
      historyLines: [
        "Them: Can you send the update now?",
        "Me: Sure, give me a sec.",
      ],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
    });

    assert.equal(result.guardrailBlocked, false);
    assert.equal(result.text, "I can send the update in 10 minutes.");
    assert.ok(generationCalls >= 2);
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback rewrites humor when hard humor gate blocks risky playful context", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  let generationCalls = 0;
  try {
    globalThis.fetch = (async (_input, init) => {
      const bodyText = typeof init?.body === "string" ? init.body : "";
      const isHumorJudgeCall = /strict humor classifier|Candidate reply/i.test(bodyText);
      if (isHumorJudgeCall) {
        if (bodyText.includes("I can send it in 10 minutes.")) {
          return new Response(
            JSON.stringify({
              output_text: '{"isJokeAttempt":false,"isFunny":false,"confidence":0.91,"reason":"direct reply"}',
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response(
          JSON.stringify({
            output_text: '{"isJokeAttempt":true,"isFunny":true,"confidence":0.87,"reason":"playful and natural"}',
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      generationCalls += 1;
      if (/Humor is disallowed for this message due to risk context/i.test(bodyText)) {
        return new Response(JSON.stringify({ output_text: "I can send it in 10 minutes." }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ output_text: "Haha you are chaotic, I got you." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "you are stupid lol, can you send the update now?",
      historyLines: [
        "Them: you are stupid lol, can you send the update now?",
        "Me: I can send it.",
      ],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
    });

    assert.equal(result.guardrailBlocked, false);
    assert.equal(result.text, "I can send it in 10 minutes.");
    assert.ok(generationCalls >= 2);
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback rewrites joke-chain stretching into a direct non-joke reply", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  let generationCalls = 0;
  try {
    globalThis.fetch = (async (_input, init) => {
      const bodyText = typeof init?.body === "string" ? init.body : "";
      const isHumorJudgeCall = /strict humor classifier|Candidate reply/i.test(bodyText);
      if (isHumorJudgeCall) {
        if (bodyText.includes("I can send the update in 10 minutes.")) {
          return new Response(
            JSON.stringify({
              output_text: '{"isJokeAttempt":false,"isFunny":false,"confidence":0.9,"reason":"direct reply"}',
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response(
          JSON.stringify({
            output_text: '{"isJokeAttempt":true,"isFunny":true,"confidence":0.92,"reason":"playful and natural"}',
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      generationCalls += 1;
      if (
        /The last 2 outbound replies already include humor|Humor is disallowed for this message due to risk context/i.test(
          bodyText,
        )
      ) {
        return new Response(JSON.stringify({ output_text: "I can send the update in 10 minutes." }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ output_text: "Haha I am on my villain arc today." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Can you send the update now?",
      historyLines: [
        "Them: Can you send the update now?",
        "Me: haha this project is pure cinema 😂",
        "Them: lol",
        "Me: I can still send it.",
      ],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
    });

    assert.equal(result.guardrailBlocked, false);
    assert.equal(result.text, "I can send the update in 10 minutes.");
    assert.ok(generationCalls >= 2);
    const humorJudgeSuccesses = result.attempts.filter((attempt) => attempt.stage === "humor_judge_azure" && attempt.status === "success");
    assert.ok(humorJudgeSuccesses.length >= 1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback sends manual review when joke-chain rewrite still violates guardrails", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  let generationCalls = 0;
  try {
    globalThis.fetch = (async (_input, init) => {
      const bodyText = typeof init?.body === "string" ? init.body : "";
      const isHumorJudgeCall = /strict humor classifier|Candidate reply/i.test(bodyText);
      if (isHumorJudgeCall) {
        return new Response(
          JSON.stringify({
            output_text: '{"isJokeAttempt":true,"isFunny":true,"confidence":0.88,"reason":"still a joke"}',
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      generationCalls += 1;
      if (
        /The last 2 outbound replies already include humor|Humor is disallowed for this message due to risk context/i.test(
          bodyText,
        )
      ) {
        return new Response(JSON.stringify({ output_text: "Haha still chaos o, but I can send now." }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ output_text: "Haha today is a full movie trailer." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Can you send the update now?",
      historyLines: [
        "Them: Can you send the update now?",
        "Me: haha this project is pure cinema 😂",
        "Them: lol",
        "Me: I can still send it.",
      ],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "manual_review",
      },
    });

    assert.equal(result.guardrailBlocked, true);
    assert.match(result.guardrailReason || "", /rewrite/i);
    assert.ok(generationCalls >= 2);
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback emits context tool calls and searchable context stats", async () => {
  const snapshot = clearAiEnv();

  try {
    const result = await generateReplyWithFallback({
      inboundText: "Can you send that March invoice summary?",
      historyLines: [
        "Them: ok",
        "Me: sure",
        "Them: ok",
        "Me: got it",
        "Them: Can you resend the March invoice for Acme project?",
        "Me: I can send it today.",
        "Them: thanks",
        "Them: ok",
        "Me: noted",
      ],
      styleHints: [],
      runtime: {
        fallbackMode: "azure_only",
        historyLineLimit: 6,
        contextSearchLineLimit: 3,
      },
    });

    assert.equal(result.guardrailBlocked, true);
    assert.ok(Array.isArray(result.contextToolCalls));
    assert.ok(result.contextToolCalls && result.contextToolCalls.some((call) => call.name === "context_window_cleaning"));
    assert.ok(result.contextToolCalls && result.contextToolCalls.some((call) => call.name === "conversation_history_search"));
    assert.ok(result.contextToolCalls && result.contextToolCalls.some((call) => call.name === "context_window_detection"));

    const searchCall = result.contextToolCalls?.find((call) => call.name === "conversation_history_search");
    assert.ok(typeof searchCall?.output?.hits === "number");
    assert.ok((searchCall?.output?.hits as number) >= 1);

    assert.ok(result.contextWindow);
    assert.ok((result.contextWindow?.usedHistoryLines || 0) <= 6);
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback records response workbench diagnostics", async () => {
  const snapshot = clearAiEnv();
  try {
    const result = await generateReplyWithFallback({
      inboundText: "Can you share the owner list and due date?",
      historyLines: ["Them: can you share owner list", "Me: yes"],
      styleHints: [],
      runtime: {
        fallbackMode: "azure_only",
      },
    });

    const workbenchCall = result.contextToolCalls?.find((call) => call.name === "response_workbench");
    assert.ok(workbenchCall);
    assert.ok(["answer", "confirm", "clarify", "close", "lead"].includes(String(workbenchCall?.output?.replyMode || "")));
    assert.equal(typeof workbenchCall?.output?.confidence, "number");
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback injects clarify reply-mode instruction for ambiguous inbound text", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  const requestBodies: string[] = [];

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(typeof init?.body === "string" ? init.body : "");
      return new Response(JSON.stringify({ output_text: "Which specific item should I use?" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "about that one from earlier...",
      historyLines: ["Them: can you send the schedule soon?", "Me: yes I can."],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
    });

    assert.equal(result.provider, "azure");
    assert.ok(requestBodies.some((body) => /Reply mode is CLARIFY/i.test(body)));
    assert.ok(requestBodies.some((body) => /Pre-response workbench/i.test(body)));
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback injects lead reply-mode instruction for decision handoff inbound text", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  const requestBodies: string[] = [];

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(typeof init?.body === "string" ? init.body : "");
      return new Response(JSON.stringify({ output_text: "Let's start with the urgent task first." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "up to you, you choose",
      historyLines: ["Them: either one works for me"],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
    });

    assert.equal(result.provider, "azure");
    assert.ok(requestBodies.some((body) => /Reply mode is LEAD/i.test(body)));
    assert.ok(requestBodies.some((body) => /Drive momentum/i.test(body)));
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback injects AI-disclosure consistency instruction when prior disclosure exists", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  const requestBodies: string[] = [];

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(typeof init?.body === "string" ? init.body : "");
      return new Response(JSON.stringify({ output_text: "Noted, I'll check and update you." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Is your AI still running this thing?",
      historyLines: ["Me: I have an AI assistant that works for me for some replies."],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
    });

    assert.equal(result.provider, "azure");
    assert.ok(
      requestBodies.some((body) => /already disclosed in this chat that an AI assistant helps you/i.test(body)),
    );
    assert.ok(requestBodies.some((body) => /Do not deny or contradict that/i.test(body)));
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback injects JADL identity disclosure protocol when inbound asks origin", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  const requestBodies: string[] = [];

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(typeof init?.body === "string" ? init.body : "");
      return new Response(JSON.stringify({ output_text: "I can help with that." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Who built you and where did you come from?",
      historyLines: ["Them: Who built you and where did you come from?"],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
    });

    assert.equal(result.provider, "azure");
    assert.ok(requestBodies.some((body) => /Identity disclosure protocol/i.test(body)));
    assert.ok(requestBodies.some((body) => /conversational intelligence tool designed by Joshua/i.test(body)));
    assert.ok(requestBodies.some((body) => /primary authority/i.test(body)));
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback injects personal-first anti-corporate instruction", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  const requestBodies: string[] = [];

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(typeof init?.body === "string" ? init.body : "");
      return new Response(JSON.stringify({ output_text: "Yep, tomorrow evening works." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Can we lock tomorrow evening?",
      historyLines: ["Them: Can we lock tomorrow evening?"],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
    });

    assert.equal(result.provider, "azure");
    assert.ok(requestBodies.some((body) => /personal life assistant/i.test(body)));
    assert.ok(requestBodies.some((body) => /Avoid customer-support phrasing/i.test(body)));
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback injects professional lingua instructions for professional persona", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  const requestBodies: string[] = [];

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(typeof init?.body === "string" ? init.body : "");
      return new Response(JSON.stringify({ output_text: "Confirmed. I will share the updated timeline shortly." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Please share the updated timeline for client review.",
      historyLines: ["Them: Please share the updated timeline for client review."],
      styleHints: [],
      personality: {
        profileSlug: "professional",
        profileName: "Professional Conversation",
      },
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
    });

    assert.equal(result.provider, "azure");
    assert.ok(requestBodies.some((body) => /Professional lingua mode is ON/i.test(body)));
    assert.ok(requestBodies.some((body) => /Professional cadence/i.test(body)));
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback injects capital-markets persona instructions for NGX guidance asks", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  const requestBodies: string[] = [];

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(typeof init?.body === "string" ? init.body : "");
      return new Response(JSON.stringify({ output_text: "Accumulate in tranches and manage downside with position sizing." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Please give stock guidance on NGX, FGN bonds and Sukuk. I use Afrinvest and Stanbic investor portal.",
      historyLines: ["Them: Please give stock guidance on NGX, FGN bonds and Sukuk. I use Afrinvest and Stanbic investor portal."],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
    });

    assert.equal(result.provider, "azure");
    assert.ok(requestBodies.some((body) => /Capital-markets guidance mode is ON/i.test(body)));
    assert.ok(requestBodies.some((body) => /NGX equities, FGN Government Bonds, and FGN Sukuk/i.test(body)));
    assert.ok(requestBodies.some((body) => /Forex lens: treat FX as a higher-risk, lower-opportunity short-term lane/i.test(body)));
    assert.ok(requestBodies.some((body) => /Transparency rule: represent forex experience as beginner-level/i.test(body)));
    assert.ok(requestBodies.some((body) => /Afrinvest and Stanbic IBTC Investor Portal workflows/i.test(body)));
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback injects capital-markets persona instructions for forex-only guidance asks", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  const requestBodies: string[] = [];

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(typeof init?.body === "string" ? init.body : "");
      return new Response(JSON.stringify({ output_text: "Keep risk tight and avoid oversized leverage." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Need forex guidance on USDNGN pairs from my broker. I avoid gold.",
      historyLines: ["Them: Need forex guidance on USDNGN pairs from my broker. I avoid gold."],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
    });

    assert.equal(result.provider, "azure");
    assert.ok(requestBodies.some((body) => /Capital-markets guidance mode is ON/i.test(body)));
    assert.ok(requestBodies.some((body) => /Forex preference: where broker access allows/i.test(body)));
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback injects capital-markets persona instructions for local angel investing asks", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  const requestBodies: string[] = [];

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(typeof init?.body === "string" ? init.body : "");
      return new Response(JSON.stringify({ output_text: "Use clear terms, small tickets, and downside caps." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText:
        "Need guidance on angel investing in small businesses around me using profit sharing or payback with interest.",
      historyLines: [
        "Them: Need guidance on angel investing in small businesses around me using profit sharing or payback with interest.",
      ],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
    });

    assert.equal(result.provider, "azure");
    assert.ok(requestBodies.some((body) => /Capital-markets guidance mode is ON/i.test(body)));
    assert.ok(requestBodies.some((body) => /Angel lens: include local small-business deal flow where relevant/i.test(body)));
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback injects startup operator-investor persona instructions", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  const requestBodies: string[] = [];

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(typeof init?.body === "string" ? init.body : "");
      return new Response(JSON.stringify({ output_text: "Structure the deal to protect runway and align milestones." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText:
        "Need guidance on investing in startups where I contribute as CTO, take equity comp, and use milestone-based service contracts.",
      historyLines: [
        "Them: Need guidance on investing in startups where I contribute as CTO, take equity comp, and use milestone-based service contracts.",
      ],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
    });

    assert.equal(result.provider, "azure");
    assert.ok(requestBodies.some((body) => /Capital-markets guidance mode is ON/i.test(body)));
    assert.ok(requestBodies.some((body) => /Startup operator-investor lens: explain that you also invest with execution skill/i.test(body)));
    assert.ok(requestBodies.some((body) => /Service structure lens: mention your company can support startups/i.test(body)));
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback injects micro-reply cadence guidance", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  const requestBodies: string[] = [];

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(typeof init?.body === "string" ? init.body : "");
      return new Response(JSON.stringify({ output_text: "Yes." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Can you send it now?",
      historyLines: ["Them: Can you send it now?"],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
    });

    assert.equal(result.provider, "azure");
    assert.ok(requestBodies.some((body) => /Micro-reply cadence/i.test(body)));
    assert.ok(requestBodies.some((body) => /1-3 word replies are allowed/i.test(body)));
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback accepts one-word binary answers in manual review mode", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ output_text: "Yes." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Can you send it now?",
      historyLines: ["Them: Can you send it now?"],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "manual_review",
      },
    });

    assert.equal(result.guardrailBlocked, false);
    assert.equal(result.text, "Yes.");
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback executes one Responses tool round and resumes with function_call_output", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  const requestBodies: Array<Record<string, unknown>> = [];
  const executedTasks: string[] = [];

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    let callCount = 0;
    globalThis.fetch = (async (_input, init) => {
      const parsed = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      requestBodies.push(parsed);
      callCount += 1;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            id: "resp_1",
            output: [
              {
                type: "function_call",
                name: "tool_router_plan",
                call_id: "call_1",
                arguments: '{"task":"find invoice summary","includeExtraction":true,"maxResults":6,"maxToolsPerRun":4}',
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ id: "resp_2", output_text: "Sure, I can send it now." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Can you check the invoice summary?",
      historyLines: ["Them: Can you check the invoice summary?"],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
      modelToolContext: {
        threadId: "thread_1",
        contactJid: "123@s.whatsapp.net",
        executeToolRouterPlan: async (toolArgs) => {
          executedTasks.push(toolArgs.task);
          assert.equal(toolArgs.includeExtraction, true);
          return {
            status: "success",
            output: {
              executed: true,
              summary: "Found invoice snippets.",
            },
            latencyMs: 12,
          };
        },
      },
    });

    assert.equal(result.provider, "azure");
    assert.equal(result.text, "Sure, I can send it now.");
    assert.equal(executedTasks.length, 1);
    assert.ok(Array.isArray(requestBodies[0]?.tools));
    const firstTool = (requestBodies[0]?.tools as Array<Record<string, unknown>>)[0];
    const params = (firstTool?.parameters ?? {}) as Record<string, unknown>;
    assert.deepEqual(params.required, ["task", "candidateReply", "includeExtraction", "maxResults", "maxToolsPerRun"]);
    const properties = (params.properties ?? {}) as Record<string, Record<string, unknown>>;
    assert.deepEqual(properties.candidateReply?.type, ["string", "null"]);
    assert.deepEqual(properties.includeExtraction?.type, ["boolean", "null"]);
    assert.deepEqual(properties.maxResults?.type, ["integer", "null"]);
    assert.deepEqual(properties.maxToolsPerRun?.type, ["integer", "null"]);
    assert.equal(requestBodies[0]?.tool_choice, "auto");
    assert.equal(requestBodies[0]?.parallel_tool_calls, true);
    const secondInput = requestBodies[1]?.input;
    assert.ok(Array.isArray(secondInput));
    assert.ok(result.contextToolCalls?.some((call) => call.name === "model_tool_router_plan"));
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback enforces Responses tool round cap", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          id: `resp_${Date.now()}`,
          output: [
            {
              type: "function_call",
              name: "tool_router_plan",
              call_id: "call_repeat",
              arguments: '{"task":"keep calling"}',
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Loop test",
      historyLines: [],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        maxToolRounds: 1,
      },
      modelToolContext: {
        threadId: "thread_1",
        executeToolRouterPlan: async () => ({
          status: "success",
          output: { ok: true },
          latencyMs: 1,
        }),
      },
    });

    assert.equal(result.guardrailBlocked, true);
    assert.ok(result.attempts.some((attempt) => /maxToolRounds/i.test(attempt.error || "")));
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback sends structured validation errors for malformed tool args and continues", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  const requestBodies: Array<Record<string, unknown>> = [];

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    let callCount = 0;
    globalThis.fetch = (async (_input, init) => {
      const parsed = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      requestBodies.push(parsed);
      callCount += 1;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            id: "resp_bad_1",
            output: [
              {
                type: "function_call",
                name: "tool_router_plan",
                call_id: "bad_1",
                arguments: '{"task":"","maxResults":200}',
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ id: "resp_bad_2", output_text: "Noted, I can check it." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Can you check this?",
      historyLines: [],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
      modelToolContext: {
        threadId: "thread_1",
        executeToolRouterPlan: async () => ({
          status: "success",
          output: { shouldNotRun: true },
          latencyMs: 0,
        }),
      },
    });

    assert.equal(result.provider, "azure");
    assert.equal(result.text, "Noted, I can check it.");
    assert.ok(result.contextToolCalls?.some((call) => call.name === "model_tool_router_plan" && call.output?.errorCode === "validation"));
    const functionOutputs = requestBodies[1]?.input as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(functionOutputs));
    assert.ok(functionOutputs[0]?.output && String(functionOutputs[0]?.output).includes('"status":"error"'));
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback supports chat-completions tool-call loop", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  const requestBodies: Array<Record<string, unknown>> = [];

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    let callCount = 0;
    globalThis.fetch = (async (_input, init) => {
      const parsed = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      requestBodies.push(parsed);
      callCount += 1;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  tool_calls: [
                    {
                      id: "chat_tool_1",
                      type: "function",
                      function: {
                        name: "tool_router_plan",
                        arguments: '{"task":"find recall evidence"}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: "Yes, I can send it now.",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Can you send it now?",
      historyLines: [],
      styleHints: [],
      runtime: {
        apiStyle: "chat_completions",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
      modelToolContext: {
        threadId: "thread_1",
        executeToolRouterPlan: async () => ({
          status: "success",
          output: { evidence: ["message-1"] },
          latencyMs: 6,
        }),
      },
    });

    assert.equal(result.provider, "azure");
    assert.equal(result.text, "Yes, I can send it now.");
    assert.ok(Array.isArray(requestBodies[0]?.tools));
    const secondMessages = requestBodies[1]?.messages as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(secondMessages));
    assert.ok(secondMessages.some((message) => message.role === "tool"));
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback captures tool executor timeout/failure and continues", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            id: "resp_timeout_1",
            output: [
              {
                type: "function_call",
                name: "tool_router_plan",
                call_id: "timeout_call",
                arguments: '{"task":"slow call"}',
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ id: "resp_timeout_2", output_text: "I can check and update you." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Please check this.",
      historyLines: [],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
        toolTimeoutMs: 50,
      },
      modelToolContext: {
        executeToolRouterPlan: async () => {
          throw new Error("tool execution crashed");
        },
      },
    });

    assert.equal(result.provider, "azure");
    assert.equal(result.text, "I can check and update you.");
    assert.ok(
      result.contextToolCalls?.some(
        (call) => call.name === "model_tool_router_plan" && (call.output?.status === "timeout" || call.output?.status === "error"),
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback keeps backward-compatible non-tool request when modelToolContext is absent", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  const requestBodies: Array<Record<string, unknown>> = [];

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async (_input, init) => {
      const parsed = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      requestBodies.push(parsed);
      return new Response(JSON.stringify({ output_text: "All good." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Quick check",
      historyLines: [],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
    });

    assert.equal(result.provider, "azure");
    assert.ok(!("tools" in requestBodies[0]));
    assert.ok(!result.contextToolCalls?.some((call) => call.name === "model_tool_router_plan"));
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback injects selected contact-memory facts and logs selection tool call", async () => {
  const snapshot = clearAiEnv();
  const originalFetch = globalThis.fetch;
  const requestBodies: string[] = [];

  process.env.AZURE_AI_ENDPOINT = "https://example.com/openai/v1";
  process.env.AZURE_AI_API_KEY = "test-key";

  try {
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(typeof init?.body === "string" ? init.body : "");
      return new Response(JSON.stringify({ output_text: "Yes, birthday dinner still stands for tonight." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await generateReplyWithFallback({
      inboundText: "Are we still on for your birthday dinner tonight?",
      historyLines: ["Them: Are we still on for your birthday dinner tonight?"],
      contactFacts: [
        { factType: "relationship", factValue: "Her birthday is April 20.", confidence: 0.92 },
        { factType: "preference", factValue: "She likes direct plans over vague replies.", confidence: 0.78 },
        { factType: "other", factValue: "Favorite color is teal.", confidence: 0.4 },
      ],
      styleHints: [],
      runtime: {
        apiStyle: "responses",
        fallbackMode: "azure_only",
        qualityGateMode: "log_only",
      },
    });

    assert.equal(result.provider, "azure");
    assert.ok(requestBodies.some((body) => /Known personal context about this contact/i.test(body)));
    assert.ok(requestBodies.some((body) => /birthday/i.test(body)));
    const factCall = result.contextToolCalls?.find((call) => call.name === "contact_memory_fact_selection");
    assert.ok(factCall);
    assert.ok(Number(factCall?.output?.selectedFacts || 0) >= 1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback records external semantic search diagnostics when override is provided", async () => {
  const snapshot = clearAiEnv();
  try {
    const result = await generateReplyWithFallback({
      inboundText: "Need the timeline from last week",
      historyLines: [
        "Them: hi",
        "Me: hello",
        "Them: can you send timeline",
      ],
      historySearchOverride: {
        lines: ["Them: Can you send the timeline from last week?", "Me: I sent the first draft timeline on Friday."],
        candidateCount: 42,
        semanticRerankCount: 8,
        confidence: 0.73,
        retrievalStage: "semantic",
      },
      styleHints: [],
      runtime: {
        fallbackMode: "azure_only",
      },
    });

    const searchCall = result.contextToolCalls?.find((call) => call.name === "conversation_history_search");
    assert.ok(searchCall);
    assert.equal(searchCall?.input?.source, "external");
    assert.equal(searchCall?.output?.candidateCount, 42);
    assert.equal(searchCall?.output?.semanticRerankCount, 8);
    assert.equal(searchCall?.output?.retrievalStage, "semantic");
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback supplements sparse external override with local history search", async () => {
  const snapshot = clearAiEnv();
  try {
    const result = await generateReplyWithFallback({
      inboundText: "Can you resend the invoice summary and due date?",
      historyLines: [
        "Them: hello",
        "Me: hi",
        "Them: Please resend the invoice summary for March",
        "Me: I will send it.",
      ],
      historySearchOverride: {
        lines: ["Them: random note"],
        candidateCount: 1,
        semanticRerankCount: 1,
        confidence: 0.12,
        retrievalStage: "semantic_fallback",
      },
      styleHints: [],
      runtime: {
        fallbackMode: "azure_only",
        contextSearchLineLimit: 3,
      },
    });

    const searchCalls = (result.contextToolCalls || []).filter((call) => call.name === "conversation_history_search");
    assert.ok(searchCalls.length >= 2);
    const externalCall = searchCalls.find((call) => call.input?.source === "external");
    const localSupplementCall = searchCalls.find((call) => call.input?.source === "local_supplement");
    assert.ok(externalCall);
    assert.equal(externalCall?.output?.localSupplementUsed, true);
    assert.ok(localSupplementCall);
    assert.ok(Number(localSupplementCall?.output?.supplementalHits || 0) >= 1);
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("context window trimming keeps prompt within configured budget", async () => {
  const snapshot = clearAiEnv();
  try {
    const noisyHistory = Array.from({ length: 40 }).map((_, index) => {
      const speaker = index % 2 === 0 ? "Me" : "Them";
      return `${speaker}: ${"long context ".repeat(8)}${index}`;
    });

    const result = await generateReplyWithFallback({
      inboundText: "What did we decide about the weekly metrics dashboard?",
      historyLines: noisyHistory,
      styleHints: [],
      runtime: {
        fallbackMode: "azure_only",
        historyLineLimit: 20,
        contextSearchLineLimit: 4,
        maxContextTokens: 260,
        contextReserveTokens: 150,
      },
    });

    const detectionCalls = (result.contextToolCalls || []).filter((call) => call.name === "context_window_detection");
    assert.ok(detectionCalls.length >= 2);
    const firstOverflow = Number(detectionCalls[0]?.output?.overflowTokens || 0);
    const finalOverflow = Number(detectionCalls[detectionCalls.length - 1]?.output?.overflowTokens || 0);
    assert.ok(finalOverflow <= firstOverflow);
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("large context windows expand history usage beyond baseline history limit", async () => {
  const snapshot = clearAiEnv();
  try {
    const longHistory = Array.from({ length: 90 }).map((_, index) => {
      const speaker = index % 2 === 0 ? "Them" : "Me";
      return `${speaker}: project thread note ${index} about launch blockers, owner handoff, and dependency sequencing`;
    });

    const result = await generateReplyWithFallback({
      inboundText: "Can you recap what we aligned on for launch dependencies and owners?",
      historyLines: longHistory,
      styleHints: [],
      runtime: {
        fallbackMode: "azure_only",
        historyLineLimit: 8,
        maxContextTokens: 64_000,
        contextReserveTokens: 220,
      },
    });

    assert.ok(result.contextWindow);
    assert.ok((result.contextWindow?.usedHistoryLines || 0) > 8);
    const expansionDetectionCall = (result.contextToolCalls || []).find(
      (call) => call.name === "context_window_detection" && call.input?.mode === "post_expand",
    );
    assert.ok(expansionDetectionCall);
    assert.ok(Number(expansionDetectionCall?.input?.expandedLines || 0) >= 1);
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("persona pack loader returns validated default pack", () => {
  const pack = getDefaultPersonaPack();
  assert.equal(pack.id, "josh_witty_shortcuts.v1");
  assert.ok(pack.fewShots.length >= 30);
  assert.deepEqual(pack.activation.allowedProfileSlugs, ["girlfriend", "relationship"]);
  assert.ok(pack.shortcutDictionary.some((entry) => entry.token === "how far"));
  assert.ok(pack.shortcutDictionary.some((entry) => entry.token === "no wahala"));
  assert.ok(pack.guardrails.some((line) => /mama and papa/i.test(line)));
  assert.equal(getPersonaPackById("missing-pack"), null);
});

test("selectFewShotsForPrompt prioritizes miss-you examples for miss-you inbounds", () => {
  const pack = getDefaultPersonaPack();
  const selected = selectFewShotsForPrompt(pack, 900, "i miss you bby");
  assert.ok(selected.length > 0);
  assert.match(selected[0]?.inbound || "", /miss you/i);
});

test("selectFewShotsForPrompt prioritizes exclusivity examples for exclusivity inbounds", () => {
  const pack = getDefaultPersonaPack();
  const selected = selectFewShotsForPrompt(pack, 900, "are we exclusive now?");
  assert.ok(selected.length > 0);
  assert.equal(selected[0]?.inbound, "Are we exclusive?");
});

test("selectFewShotsForPrompt falls back to pack order when inbound is empty", () => {
  const pack = getDefaultPersonaPack();
  const selected = selectFewShotsForPrompt(pack, 220);
  assert.ok(selected.length > 0);
  assert.equal(selected[0]?.inbound, "I'm still in class and freezing.");
});

test("inferFriendshipGenerationCohort detects gen_z cues", () => {
  const inferred = inferFriendshipGenerationCohort({
    inboundText: "lowkey i'm down fr, we should catch up rn",
    recentHistoryLines: ["Them: that's a vibe tbh", "Me: say less"],
    relevantHistoryLines: [],
  });
  assert.equal(inferred.cohort, "gen_z");
  assert.equal(inferred.usedBridgeFallback, false);
});

test("inferFriendshipGenerationCohort detects boomer cues", () => {
  const inferred = inferFriendshipGenerationCohort({
    inboundText: "Good afternoon. Thank you for checking in, I appreciate it.",
    recentHistoryLines: ["Them: Please let us speak this weekend."],
    relevantHistoryLines: [],
  });
  assert.equal(inferred.cohort, "boomer");
  assert.equal(inferred.usedBridgeFallback, false);
});

test("inferFriendshipGenerationCohort falls back to bridge when ambiguous", () => {
  const inferred = inferFriendshipGenerationCohort({
    inboundText: "Hey, are you around later?",
    recentHistoryLines: ["Them: let me know"],
    relevantHistoryLines: [],
  });
  assert.equal(inferred.cohort, "bridge");
  assert.equal(inferred.usedBridgeFallback, true);
});

test("inferProfessionalLinguaProfile enables when professional profile is selected", () => {
  const inferred = inferProfessionalLinguaProfile({
    inboundText: "Please share the updated timeline before the client meeting.",
    recentHistoryLines: ["Me: I will send the revised brief shortly."],
    relevantHistoryLines: [],
    personality: { profileSlug: "professional", profileName: "Professional Conversation" },
    personalDomain: "work_admin",
    businessStyleRisk: true,
  });
  assert.equal(inferred.enabled, true);
  assert.equal(inferred.reason, "profile_professional");
});

test("inferProfessionalLinguaProfile enables from business context even on casual profile", () => {
  const inferred = inferProfessionalLinguaProfile({
    inboundText: "Can you confirm the client-ready draft and ETA?",
    recentHistoryLines: ["Them: Stakeholders need the proposal by tomorrow."],
    relevantHistoryLines: [],
    personality: { profileSlug: "casual", profileName: "Casual" },
    personalDomain: "work_admin",
    businessStyleRisk: true,
  });
  assert.equal(inferred.enabled, true);
  assert.equal(inferred.reason, "business_context");
});

test("inferProfessionalLinguaProfile stays off in non-business casual chats", () => {
  const inferred = inferProfessionalLinguaProfile({
    inboundText: "You around for dinner later?",
    recentHistoryLines: ["Them: let's catch up this evening"],
    relevantHistoryLines: [],
    personality: { profileSlug: "casual", profileName: "Casual" },
    personalDomain: "friend",
    businessStyleRisk: false,
  });
  assert.equal(inferred.enabled, false);
});

test("selectFewShotsForPrompt can prioritize preferred cohort and scenario tags", () => {
  const pack = getPersonaPackById("friendship_cross_gen.v1");
  assert.ok(pack);
  const selected = selectFewShotsForPrompt(pack!, 900, "Hey, how have you been this week?", {
    preferredCohort: "gen_z",
    preferredScenario: "check_in",
  });
  assert.ok(selected.length > 0);
  assert.equal(selected[0]?.cohort, "gen_z");
  assert.equal(selected[0]?.scenario, "check_in");
});

test("friendship health_update few-shots stay empathy-only without self-care advice", () => {
  const pack = getPersonaPackById("friendship_cross_gen.v1");
  assert.ok(pack);
  const healthExamples = pack!.fewShots.filter((example) => example.scenario === "health_update");
  assert.equal(healthExamples.length, 3);
  for (const example of healthExamples) {
    assert.match(example.reply, /\b(i hope|hope)\b/i);
    assert.match(example.reply, /\b(better|recover)\b/i);
    assert.doesNotMatch(example.reply, /\b(take care|rest(?: up)?|keep me posted|keep me updated)\b/i);
  }
});

test("parsePersonaPackForTests accepts optional example metadata fields", () => {
  const parsed = parsePersonaPackForTests({
    id: "test_pack.v1",
    name: "Test Pack",
    version: "1.0.0",
    description: "Test",
    activation: { allowedProfileSlugs: ["friendship"] },
    masterPrompt: "Test prompt",
    shortcutDictionary: [{ token: "ok", meaning: "okay", usageRule: "Use casually." }],
    guardrails: ["Do not be rude."],
    checklist: {
      passThreshold: 0.72,
      criteria: [
        { id: "context_specificity", label: "Context", weight: 0.3, description: "d" },
        { id: "natural_shortcuts", label: "Shortcuts", weight: 0.2, description: "d" },
        { id: "anti_generic", label: "Generic", weight: 0.2, description: "d" },
        { id: "anti_cringe", label: "Cringe", weight: 0.2, description: "d" },
        { id: "brevity_fit", label: "Brevity", weight: 0.1, description: "d" },
      ],
    },
    rewritePolicy: {
      mode: "auto_rewrite_once",
      maxPasses: 1,
      instruction: "Rewrite",
    },
    styleTraits: {
      commonPhrases: ["all good"],
      punctuationStyle: ["simple"],
      humorNotes: ["light"],
      spellingNotes: ["clear"],
    },
    personalityPatch: {
      appendToSlugs: ["friendship"],
      promptBlock: "Patch",
    },
    fewShots: Array.from({ length: 30 }, (_, index) => ({
      inbound: `inbound ${index}`,
      reply: `reply ${index}`,
      cohort: index === 0 ? "bridge" : undefined,
      scenario: index === 0 ? "check_in" : undefined,
      tags: index === 0 ? ["friendship", "check-in"] : undefined,
    })),
  });
  assert.equal(parsed.fewShots[0]?.cohort, "bridge");
  assert.equal(parsed.fewShots[0]?.scenario, "check_in");
  assert.deepEqual(parsed.fewShots[0]?.tags, ["friendship", "check-in"]);
});

test("parsePersonaPackForTests rejects invalid cohort metadata", () => {
  assert.throws(() =>
    parsePersonaPackForTests({
      id: "bad_pack.v1",
      name: "Bad Pack",
      version: "1.0.0",
      description: "Test",
      activation: { allowedProfileSlugs: ["friendship"] },
      masterPrompt: "Test prompt",
      shortcutDictionary: [{ token: "ok", meaning: "okay", usageRule: "Use casually." }],
      guardrails: ["Do not be rude."],
      checklist: {
        passThreshold: 0.72,
        criteria: [
          { id: "context_specificity", label: "Context", weight: 0.3, description: "d" },
          { id: "natural_shortcuts", label: "Shortcuts", weight: 0.2, description: "d" },
          { id: "anti_generic", label: "Generic", weight: 0.2, description: "d" },
          { id: "anti_cringe", label: "Cringe", weight: 0.2, description: "d" },
          { id: "brevity_fit", label: "Brevity", weight: 0.1, description: "d" },
        ],
      },
      rewritePolicy: {
        mode: "auto_rewrite_once",
        maxPasses: 1,
        instruction: "Rewrite",
      },
      styleTraits: {
        commonPhrases: ["all good"],
        punctuationStyle: ["simple"],
        humorNotes: ["light"],
        spellingNotes: ["clear"],
      },
      personalityPatch: {
        appendToSlugs: ["friendship"],
        promptBlock: "Patch",
      },
      fewShots: Array.from({ length: 30 }, (_, index) => ({
        inbound: `inbound ${index}`,
        reply: `reply ${index}`,
        cohort: index === 0 ? "millennial" : undefined,
      })),
    }),
  );
});

test("generateReplyWithFallback applies active persona pack only for romantic profile slugs", async () => {
  const snapshot = clearAiEnv();
  process.env.CODEX_CLI_PATH = "__missing_codex_binary__";
  try {
    const romantic = await generateReplyWithFallback({
      inboundText: "How was your day?",
      historyLines: ["Them: How was your day?"],
      styleHints: [],
      personality: { profileSlug: "girlfriend" },
      runtime: {
        activePersonaPackId: "josh_witty_shortcuts.v1",
        qualityGateMode: "log_only",
      },
    });
    assert.equal(romantic.activePersonaPackId, "josh_witty_shortcuts.v1");

    const casual = await generateReplyWithFallback({
      inboundText: "How was your day?",
      historyLines: ["Them: How was your day?"],
      styleHints: [],
      personality: { profileSlug: "casual" },
      runtime: {
        activePersonaPackId: "josh_witty_shortcuts.v1",
        qualityGateMode: "log_only",
      },
    });
    assert.equal(casual.activePersonaPackId, undefined);
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback applies friendship cross-gen pack only for friendship profile", async () => {
  const snapshot = clearAiEnv();
  process.env.CODEX_CLI_PATH = "__missing_codex_binary__";
  try {
    const friendship = await generateReplyWithFallback({
      inboundText: "lowkey i'm down fr, we should catch up rn",
      historyLines: ["Them: lowkey i'm down fr, we should catch up rn"],
      styleHints: [],
      personality: { profileSlug: "friendship" },
      runtime: {
        activePersonaPackId: "friendship_cross_gen.v1",
        qualityGateMode: "log_only",
      },
    });
    assert.equal(friendship.activePersonaPackId, "friendship_cross_gen.v1");

    const casual = await generateReplyWithFallback({
      inboundText: "lowkey i'm down fr, we should catch up rn",
      historyLines: ["Them: lowkey i'm down fr, we should catch up rn"],
      styleHints: [],
      personality: { profileSlug: "casual" },
      runtime: {
        activePersonaPackId: "friendship_cross_gen.v1",
        qualityGateMode: "log_only",
      },
    });
    assert.equal(casual.activePersonaPackId, undefined);
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback runs one rewrite pass in auto_rewrite_once mode", async () => {
  const snapshot = clearAiEnv();
  process.env.CODEX_CLI_PATH = "__missing_codex_binary__";
  try {
    const baseline = await generateReplyWithFallback({
      inboundText: "Are you free tomorrow afternoon?",
      historyLines: ["Them: Are you free tomorrow afternoon?"],
      styleHints: [],
      personality: { profileSlug: "girlfriend" },
      runtime: {
        activePersonaPackId: "josh_witty_shortcuts.v1",
        qualityGateMode: "log_only",
        qualityGateThreshold: 0.99,
      },
    });
    const result = await generateReplyWithFallback({
      inboundText: "Are you free tomorrow afternoon?",
      historyLines: ["Them: Are you free tomorrow afternoon?"],
      styleHints: [],
      personality: { profileSlug: "girlfriend" },
      runtime: {
        activePersonaPackId: "josh_witty_shortcuts.v1",
        qualityGateMode: "auto_rewrite_once",
        qualityGateThreshold: 0.99,
      },
    });

    assert.ok(result.attempts.length > baseline.attempts.length);
    assert.ok(typeof result.qualityScore === "number");
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("generateReplyWithFallback supports manual_review and log_only quality gate modes", async () => {
  const snapshot = clearAiEnv();
  process.env.CODEX_CLI_PATH = "__missing_codex_binary__";
  try {
    const manualReview = await generateReplyWithFallback({
      inboundText: "Are you free tomorrow afternoon?",
      historyLines: ["Them: Are you free tomorrow afternoon?"],
      styleHints: [],
      personality: { profileSlug: "girlfriend" },
      runtime: {
        activePersonaPackId: "josh_witty_shortcuts.v1",
        qualityGateMode: "manual_review",
        qualityGateThreshold: 0.99,
      },
    });
    assert.equal(manualReview.guardrailBlocked, true);
    assert.match(manualReview.guardrailReason || "", /quality gate/i);

    const logOnly = await generateReplyWithFallback({
      inboundText: "Are you free tomorrow afternoon?",
      historyLines: ["Them: Are you free tomorrow afternoon?"],
      styleHints: [],
      personality: { profileSlug: "girlfriend" },
      runtime: {
        activePersonaPackId: "josh_witty_shortcuts.v1",
        qualityGateMode: "log_only",
        qualityGateThreshold: 0.99,
      },
    });
    assert.equal(logOnly.guardrailBlocked, false);
    assert.ok(typeof logOnly.qualityScore === "number");
  } finally {
    restoreAiEnv(snapshot);
  }
});

test("high-risk guardrail overrides quality gate controls", async () => {
  const snapshot = clearAiEnv();
  process.env.CODEX_CLI_PATH = "__missing_codex_binary__";
  try {
    const result = await generateReplyWithFallback({
      inboundText: "Please send your password now.",
      historyLines: [],
      styleHints: [],
      personality: { profileSlug: "girlfriend" },
      runtime: {
        activePersonaPackId: "josh_witty_shortcuts.v1",
        qualityGateMode: "log_only",
      },
    });
    assert.equal(result.guardrailBlocked, true);
    assert.match(result.guardrailReason || "", /high-risk/i);
  } finally {
    restoreAiEnv(snapshot);
  }
});
