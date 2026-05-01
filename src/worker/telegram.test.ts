import assert from "node:assert/strict";
import test from "node:test";
import bigInt from "big-integer";
import { Api } from "telegram";
import {
  entityDisplayName,
  jidToEntity,
  normalizeTelegramMessageText,
  normalizeTelegramMessageType,
  peerToJid,
  telegramMessageAtMs,
} from "./telegram";

test("peerToJid and jidToEntity round-trip Telegram peer ids", () => {
  assert.equal(peerToJid(new Api.PeerUser({ userId: bigInt(123) })), "tg:user:123");
  assert.equal(peerToJid(new Api.PeerChat({ chatId: bigInt(456) })), "tg:chat:456");
  assert.equal(peerToJid(new Api.PeerChannel({ channelId: bigInt(789) })), "tg:channel:789");

  const user = jidToEntity("tg:user:123");
  const chat = jidToEntity("tg:chat:456");
  const channel = jidToEntity("tg:channel:789");

  assert.equal(user instanceof Api.PeerUser, true);
  assert.equal(chat instanceof Api.PeerChat, true);
  assert.equal(channel instanceof Api.PeerChannel, true);
  assert.equal((user as Api.PeerUser).userId.toString(), "123");
  assert.equal((chat as Api.PeerChat).chatId.toString(), "456");
  assert.equal((channel as Api.PeerChannel).channelId.toString(), "789");
});

test("jidToEntity preserves usernames and numeric legacy ids", () => {
  assert.equal(jidToEntity("@family_friend"), "@family_friend");
  assert.equal(jidToEntity("12345"), 12345);
});

test("entityDisplayName prefers human-readable Telegram names", () => {
  assert.equal(
    entityDisplayName(
      new Api.User({
        id: bigInt(1),
        firstName: "Ada",
        lastName: "Lovelace",
      }),
    ),
    "Ada Lovelace",
  );
  assert.equal(entityDisplayName(new Api.Chat({ id: bigInt(2), title: "Family", photo: new Api.ChatPhotoEmpty(), participantsCount: 3, date: 0, version: 1 })), "Family");
});

test("Telegram message normalization keeps text and labels media", () => {
  const text = { rawText: "  hello from Telegram  ", message: "" } as Api.Message;
  const image = { rawText: "", message: "", photo: {} } as Api.Message;
  const voice = { rawText: "", message: "", voice: {} } as Api.Message;
  const document = { rawText: "", message: "", document: {} } as Api.Message;

  assert.equal(normalizeTelegramMessageText(text), "hello from Telegram");
  assert.equal(normalizeTelegramMessageType(text), "text");
  assert.equal(normalizeTelegramMessageText(image), "[Image]");
  assert.equal(normalizeTelegramMessageType(image), "image");
  assert.equal(normalizeTelegramMessageText(voice), "[Audio]");
  assert.equal(normalizeTelegramMessageType(voice), "audio");
  assert.equal(normalizeTelegramMessageText(document), "[Document]");
  assert.equal(normalizeTelegramMessageType(document), "document");
});

test("telegramMessageAtMs converts Telegram seconds to milliseconds", () => {
  assert.equal(telegramMessageAtMs({ date: 1_700_000_000 } as Api.Message), 1_700_000_000_000);
});
