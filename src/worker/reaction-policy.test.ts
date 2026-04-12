import assert from "node:assert/strict";
import test from "node:test";
import { chooseReactionEmoji } from "./reaction-policy";

test("chooseReactionEmoji maps gratitude to folded hands", () => {
  assert.equal(chooseReactionEmoji("Thanks for this update."), "🙏");
});

test("chooseReactionEmoji maps celebrations to party popper", () => {
  assert.equal(chooseReactionEmoji("Congrats, you got the promotion!"), "🎉");
});

test("chooseReactionEmoji maps humor to laughing face", () => {
  assert.equal(chooseReactionEmoji("lol this is hilarious"), "😂");
});

test("chooseReactionEmoji maps affection to heart", () => {
  assert.equal(chooseReactionEmoji("I love this so much"), "❤️");
});

test("chooseReactionEmoji maps strong positive praise to fire", () => {
  assert.equal(chooseReactionEmoji("This is amazing, perfect work"), "🔥");
});

test("chooseReactionEmoji keeps confirmations on thumbs up", () => {
  assert.equal(chooseReactionEmoji("okay noted, done"), "👍");
});

test("chooseReactionEmoji maps greeting to wave", () => {
  assert.equal(chooseReactionEmoji("Hey there"), "👋");
});

test("chooseReactionEmoji maps question-like text to eyes", () => {
  assert.equal(chooseReactionEmoji("Can you check this update?"), "👀");
});

test("chooseReactionEmoji maps audio placeholders to headphones", () => {
  assert.equal(chooseReactionEmoji("[Voice note]"), "🎧");
});

test("chooseReactionEmoji maps image placeholders to eyes", () => {
  assert.equal(chooseReactionEmoji("[Image]"), "👀");
});

test("chooseReactionEmoji maps sticker placeholders to laugh", () => {
  assert.equal(chooseReactionEmoji("[Sticker]"), "😂");
});

test("chooseReactionEmoji maps apology to folded hands", () => {
  assert.equal(chooseReactionEmoji("Sorry, my bad"), "🙏");
});

test("chooseReactionEmoji maps condolences to folded hands", () => {
  assert.equal(chooseReactionEmoji("Sorry for your loss. RIP."), "🙏");
});

test("chooseReactionEmoji defaults to thumbs up", () => {
  assert.equal(chooseReactionEmoji("Noted internally"), "👍");
});
