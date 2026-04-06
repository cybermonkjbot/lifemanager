import assert from "node:assert/strict";
import test from "node:test";
import { describeInboundImageWithFallback, detectConversationSteeringMode, normalizeOutboundText } from "./ai";

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

test("detectConversationSteeringMode flags wrap-up acknowledgements", () => {
  const mode = detectConversationSteeringMode({
    inboundText: "Thanks, all good.",
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

test("describeInboundImageWithFallback returns heuristic fallback when Azure config is missing", async () => {
  const oldEndpoint = process.env.AZURE_AI_ENDPOINT;
  const oldOpenAiEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const oldAiKey = process.env.AZURE_AI_API_KEY;
  const oldOpenAiKey = process.env.AZURE_OPENAI_API_KEY;
  const oldApiKey = process.env.OPENAI_API_KEY;

  delete process.env.AZURE_AI_ENDPOINT;
  delete process.env.AZURE_OPENAI_ENDPOINT;
  delete process.env.AZURE_AI_API_KEY;
  delete process.env.AZURE_OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

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
    if (oldEndpoint === undefined) {
      delete process.env.AZURE_AI_ENDPOINT;
    } else {
      process.env.AZURE_AI_ENDPOINT = oldEndpoint;
    }
    if (oldOpenAiEndpoint === undefined) {
      delete process.env.AZURE_OPENAI_ENDPOINT;
    } else {
      process.env.AZURE_OPENAI_ENDPOINT = oldOpenAiEndpoint;
    }
    if (oldAiKey === undefined) {
      delete process.env.AZURE_AI_API_KEY;
    } else {
      process.env.AZURE_AI_API_KEY = oldAiKey;
    }
    if (oldOpenAiKey === undefined) {
      delete process.env.AZURE_OPENAI_API_KEY;
    } else {
      process.env.AZURE_OPENAI_API_KEY = oldOpenAiKey;
    }
    if (oldApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = oldApiKey;
    }
  }
});
