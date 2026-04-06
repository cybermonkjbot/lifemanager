import assert from "node:assert/strict";
import test from "node:test";
import { parseInboundMessage } from "./whatsapp";

test("parseInboundMessage handles plain text", () => {
  const parsed = parseInboundMessage({
    conversation: "Hello there",
  } as unknown as Parameters<typeof parseInboundMessage>[0]);
  assert.deepEqual(parsed, {
    kind: "text",
    text: "Hello there",
  });
});

test("parseInboundMessage handles reactions with target id", () => {
  const parsed = parseInboundMessage({
    reactionMessage: {
      text: "🔥",
      key: {
        id: "target-123",
      },
    },
  } as unknown as Parameters<typeof parseInboundMessage>[0]);
  assert.deepEqual(parsed, {
    kind: "reaction",
    text: "Reacted with 🔥",
    emoji: "🔥",
    targetWhatsAppMessageId: "target-123",
  });
});

test("parseInboundMessage handles stickers", () => {
  const parsed = parseInboundMessage({
    stickerMessage: {
      accessibilityLabel: "funny face",
    },
  } as unknown as Parameters<typeof parseInboundMessage>[0]);
  assert.deepEqual(parsed, {
    kind: "sticker",
    text: "[Sticker]",
    caption: "funny face",
  });
});
