import assert from "node:assert/strict";
import test from "node:test";
import type { Message } from "@photon-ai/imessage-kit";
import {
  iMessageDirection,
  iMessageAtMs,
  iMessageSenderJid,
  iMessageThreadKind,
  iMessageThreadJid,
  isIMessagePlatformSupported,
  normalizeIMessageText,
  normalizeIMessageType,
} from "./imessage";

function imessage(overrides: Partial<Message>): Message {
  return {
    id: "msg-1",
    chatId: "chat-1",
    participant: "person@example.com",
    text: "",
    chatKind: "direct",
    attachments: [],
    createdAt: new Date(1_700_000_000_000),
    ...overrides,
  } as Message;
}

test("iMessage normalization keeps text and labels attachments", () => {
  assert.equal(normalizeIMessageText(imessage({ text: "  hello from Messages  " })), "hello from Messages");
  assert.equal(normalizeIMessageType(imessage({ text: "hello" })), "text");

  const image = imessage({ attachments: [{ mimeType: "image/jpeg" }] as unknown as Message["attachments"] });
  const video = imessage({ attachments: [{ mimeType: "video/mp4" }] as unknown as Message["attachments"] });
  const audio = imessage({ attachments: [{ mimeType: "audio/mpeg" }] as unknown as Message["attachments"] });
  const document = imessage({ attachments: [{ mimeType: "application/pdf" }] as unknown as Message["attachments"] });

  assert.equal(normalizeIMessageText(image), "[Image]");
  assert.equal(normalizeIMessageType(image), "image");
  assert.equal(normalizeIMessageText(video), "[Video]");
  assert.equal(normalizeIMessageType(video), "video");
  assert.equal(normalizeIMessageText(audio), "[Audio]");
  assert.equal(normalizeIMessageType(audio), "audio");
  assert.equal(normalizeIMessageText(document), "[Attachment]");
  assert.equal(normalizeIMessageType(document), "document");
});

test("iMessage normalization handles reactions and ids", () => {
  const reaction = imessage({
    reaction: {
      kind: "liked",
      emoji: "👍",
      targetMessageId: "target-1",
      textRange: undefined,
      isRemoved: false,
    },
  } as unknown as Partial<Message>);

  assert.equal(normalizeIMessageText(reaction), "Reacted with 👍");
  assert.equal(normalizeIMessageType(reaction), "reaction");
  assert.equal(iMessageThreadJid(reaction), "chat-1");
  assert.equal(iMessageSenderJid(reaction), "person@example.com");
  assert.equal(iMessageSenderJid(imessage({ chatId: "", participant: "" })), "imessage:unknown");
  assert.equal(iMessageDirection(imessage({ isFromMe: false })), "inbound");
  assert.equal(iMessageDirection(imessage({ isFromMe: true })), "outbound");
  assert.equal(iMessageThreadKind(imessage({ chatKind: "dm" })), "direct");
  assert.equal(iMessageThreadKind(imessage({ chatKind: "group" })), "group");
});

test("iMessage date and platform guards are explicit", () => {
  assert.equal(iMessageAtMs(imessage({ createdAt: new Date(1_700_000_000_000) })), 1_700_000_000_000);
  assert.equal(isIMessagePlatformSupported("darwin"), true);
  assert.equal(isIMessagePlatformSupported("linux"), false);
  assert.equal(isIMessagePlatformSupported("win32"), false);
});
