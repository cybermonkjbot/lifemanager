import assert from "node:assert/strict";
import test from "node:test";
import { classifyThreadKindFromJid, isBroadcastOrSystemJid, parseInboundMessage } from "./whatsapp";

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
      mimetype: "image/webp",
    },
  } as unknown as Parameters<typeof parseInboundMessage>[0]);
  assert.deepEqual(parsed, {
    kind: "sticker",
    text: "[Sticker]",
    caption: "funny face",
    mimeType: "image/webp",
  });
});

test("parseInboundMessage handles images with caption", () => {
  const parsed = parseInboundMessage({
    imageMessage: {
      caption: "check this out",
      mimetype: "image/jpeg",
    },
  } as unknown as Parameters<typeof parseInboundMessage>[0]);
  assert.deepEqual(parsed, {
    kind: "image",
    text: "[Image] check this out",
    caption: "check this out",
    mimeType: "image/jpeg",
  });
});

test("parseInboundMessage handles voice notes", () => {
  const parsed = parseInboundMessage({
    audioMessage: {
      mimetype: "audio/ogg; codecs=opus",
      seconds: 19,
      ptt: true,
    },
  } as unknown as Parameters<typeof parseInboundMessage>[0]);
  assert.deepEqual(parsed, {
    kind: "audio",
    text: "[Voice note]",
    mimeType: "audio/ogg; codecs=opus",
    durationSeconds: 19,
    isVoiceNote: true,
  });
});

test("parseInboundMessage unwraps ephemeral wrappers", () => {
  const parsed = parseInboundMessage({
    ephemeralMessage: {
      message: {
        extendedTextMessage: {
          text: "wrapped hello",
        },
      },
    },
  } as unknown as Parameters<typeof parseInboundMessage>[0]);
  assert.deepEqual(parsed, {
    kind: "text",
    text: "wrapped hello",
  });
});

test("isBroadcastOrSystemJid detects status and newsletter threads", () => {
  assert.equal(isBroadcastOrSystemJid("status@broadcast"), true);
  assert.equal(isBroadcastOrSystemJid("12345@newsletter"), true);
  assert.equal(isBroadcastOrSystemJid("2348@g.us"), false);
});

test("classifyThreadKindFromJid classifies direct/group/broadcast", () => {
  assert.equal(classifyThreadKindFromJid("2348@g.us"), "group");
  assert.equal(classifyThreadKindFromJid("status@broadcast"), "broadcast_or_system");
  assert.equal(classifyThreadKindFromJid("5551999999999@s.whatsapp.net"), "direct");
});
