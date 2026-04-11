import assert from "node:assert/strict";
import test from "node:test";
import { prepareStickerVisionInput, shouldExtractStickerMidFrame } from "./sticker-vision-frame";

test("shouldExtractStickerMidFrame recognizes animated sticker mime types", () => {
  assert.equal(shouldExtractStickerMidFrame("image/webp"), true);
  assert.equal(shouldExtractStickerMidFrame("application/x-tgsticker"), true);
  assert.equal(shouldExtractStickerMidFrame("application/json+lottie"), true);
  assert.equal(shouldExtractStickerMidFrame("image/png"), false);
});

test("prepareStickerVisionInput keeps non-animated mime bytes unchanged", async () => {
  const source = Buffer.from("png-bytes");
  const prepared = await prepareStickerVisionInput({
    stickerBytes: source,
    mimeType: "image/png",
  });

  assert.equal(prepared.extractedFrame, false);
  assert.equal(prepared.mimeType, "image/png");
  assert.equal(prepared.imageBytes.equals(source), true);
  assert.equal(prepared.error, undefined);
});

test("prepareStickerVisionInput falls back when frame extraction fails", async () => {
  const source = Buffer.from("webp-bytes");
  const prepared = await prepareStickerVisionInput({
    stickerBytes: source,
    mimeType: "image/webp",
    ffprobePath: "/missing/ffprobe",
    ffmpegPath: "/missing/ffmpeg",
    timeoutMs: 1_000,
  });

  assert.equal(prepared.extractedFrame, false);
  assert.equal(prepared.mimeType, "image/webp");
  assert.equal(prepared.imageBytes.equals(source), true);
  assert.equal(Boolean(prepared.error), true);
});
