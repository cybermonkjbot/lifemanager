import assert from "node:assert/strict";
import test from "node:test";
import { extractPreviewUrls, isSafePreviewUrl, normalizePreviewUrl } from "./urlPreview";

test("extractPreviewUrls dedupes and trims common trailing punctuation", () => {
  assert.deepEqual(extractPreviewUrls("Read https://example.com/a?b=1, then https://example.com/a?b=1."), [
    "https://example.com/a?b=1",
  ]);
});

test("normalizePreviewUrl removes fragments and rejects non-http urls", () => {
  assert.equal(normalizePreviewUrl("https://example.com/page#section"), "https://example.com/page");
  assert.equal(normalizePreviewUrl("ftp://example.com/file"), null);
});

test("isSafePreviewUrl blocks local and private network targets", () => {
  assert.equal(isSafePreviewUrl("http://localhost:3000"), false);
  assert.equal(isSafePreviewUrl("http://127.0.0.1:3000"), false);
  assert.equal(isSafePreviewUrl("http://192.168.1.10"), false);
  assert.equal(isSafePreviewUrl("https://example.com/article"), true);
});
