import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeInboundMessageType,
  normalizeInboundText,
  parseInstagramTimestampMs,
  parseThreadIdFromJid,
  shouldSkipInstagramTextOnlyStory,
} from "./instagram";

test("parseInstagramTimestampMs handles second/millisecond/microsecond values", () => {
  assert.equal(parseInstagramTimestampMs("1712584501", 0), 1712584501000);
  assert.equal(parseInstagramTimestampMs("1712584501000", 0), 1712584501000);
  assert.equal(parseInstagramTimestampMs("1712584501000000", 0), 1712584501000);
});

test("parseThreadIdFromJid supports prefixed Instagram thread ids", () => {
  assert.equal(parseThreadIdFromJid("ig:thread:340282366841710300949128271273557437730"), "340282366841710300949128271273557437730");
  assert.equal(parseThreadIdFromJid("instagram:thread:abc123"), "abc123");
  assert.equal(parseThreadIdFromJid("status@broadcast"), null);
});

test("normalize inbound item text and type fallbacks", () => {
  assert.equal(normalizeInboundText("like", ""), "Reacted with ❤️");
  assert.equal(normalizeInboundText("voice_media", ""), "[Voice note]");
  assert.equal(normalizeInboundText("media", ""), "[Image]");
  assert.equal(normalizeInboundMessageType("like"), "reaction");
  assert.equal(normalizeInboundMessageType("video"), "video");
  assert.equal(normalizeInboundMessageType("voice_media"), "audio");
  assert.equal(normalizeInboundMessageType("reel_share"), "image");
});

test("shouldSkipInstagramTextOnlyStory skips stories without media", () => {
  assert.equal(shouldSkipInstagramTextOnlyStory({ isStatusPost: true, mediaAssetId: undefined }), true);
  assert.equal(shouldSkipInstagramTextOnlyStory({ isStatusPost: true, mediaAssetId: "asset_1" }), false);
  assert.equal(shouldSkipInstagramTextOnlyStory({ isStatusPost: false, mediaAssetId: undefined }), false);
});
