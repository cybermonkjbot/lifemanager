import assert from "node:assert/strict";
import test from "node:test";
import { isImageLikeMedia } from "./media";

test("isImageLikeMedia does not treat video memes as images", () => {
  assert.equal(isImageLikeMedia("meme", "video/mp4"), false);
});

test("isImageLikeMedia keeps image memes as image previews", () => {
  assert.equal(isImageLikeMedia("meme", "image/png"), true);
});

test("isImageLikeMedia falls back to kind when mime type is missing", () => {
  assert.equal(isImageLikeMedia("meme", ""), true);
  assert.equal(isImageLikeMedia("image", ""), true);
  assert.equal(isImageLikeMedia("video", ""), false);
});
