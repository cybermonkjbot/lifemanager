import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRollingStickerThreadMode, needsTextReplyInStickerMode } from "./sticker-thread-mode";

test("evaluateRollingStickerThreadMode enables when recent window is sticker-dominant", () => {
  const signal = evaluateRollingStickerThreadMode({
    threadMessages: [
      { messageType: "text", text: "hey" },
      { messageType: "sticker", text: "[Sticker]" },
      { messageType: "reaction", text: "🔥" },
      { messageType: "sticker", text: "[Sticker]" },
      { messageType: "sticker", text: "[Sticker]" },
      { messageType: "reaction", text: "😂" },
      { messageType: "text", text: "lol" },
      { messageType: "sticker", text: "[Sticker]" },
    ],
  });

  assert.equal(signal.enabled, true);
  assert.ok(signal.stickerRatio >= 0.38);
  assert.ok(signal.stickerReactionRatio >= 0.62);
});

test("evaluateRollingStickerThreadMode stays off when thread is mostly text", () => {
  const signal = evaluateRollingStickerThreadMode({
    threadMessages: [
      { messageType: "text", text: "hello" },
      { messageType: "text", text: "how are you" },
      { messageType: "text", text: "all good" },
      { messageType: "reaction", text: "👍" },
      { messageType: "text", text: "check this" },
      { messageType: "text", text: "sure" },
      { messageType: "sticker", text: "[Sticker]" },
      { messageType: "text", text: "later" },
    ],
  });

  assert.equal(signal.enabled, false);
});

test("needsTextReplyInStickerMode flags direct ask as text-needed", () => {
  const needed = needsTextReplyInStickerMode({
    inboundText: "Can you send that update now?",
    inboundKind: "text",
  });
  assert.equal(needed, true);
});

test("needsTextReplyInStickerMode keeps sticker-only acknowledgment non-text", () => {
  const needed = needsTextReplyInStickerMode({
    inboundText: "[Sticker]",
    inboundKind: "sticker",
  });
  assert.equal(needed, false);
});
