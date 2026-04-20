import assert from "node:assert/strict";
import test from "node:test";
import { mapOpenAiMessagesToInboundAndHistory, openAiContentToText, resolveGatewayThreadId } from "./openai-gateway";

test("openAiContentToText supports string and array part payloads", () => {
  assert.equal(openAiContentToText("hello"), "hello");
  assert.equal(
    openAiContentToText([
      { type: "text", text: "alpha" },
      { type: "input_text", text: "beta" },
      { type: "other", text: { value: "gamma" } },
    ]),
    "alpha\nbeta\ngamma",
  );
});

test("mapOpenAiMessagesToInboundAndHistory chooses latest user turn as inbound", () => {
  const mapped = mapOpenAiMessagesToInboundAndHistory([
    { role: "system", content: "follow rules" },
    { role: "user", content: "hi" },
    { role: "assistant", content: "hey there" },
    { role: "user", content: "how far?" },
  ]);

  assert.equal(mapped.inboundText, "how far?");
  assert.deepEqual(mapped.historyLines, ["System: follow rules", "Them: hi", "Me: hey there"]);
});

test("resolveGatewayThreadId supports metadata and user thread: prefix", () => {
  assert.equal(resolveGatewayThreadId({ metadata: { threadId: "abc123" } }), "abc123");
  assert.equal(resolveGatewayThreadId({ user: "thread:xyz789" }), "xyz789");
  assert.equal(resolveGatewayThreadId({ user: "plain-user" }), undefined);
});
