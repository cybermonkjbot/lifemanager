import assert from "node:assert/strict";
import test from "node:test";

import {
  extractStickerProviderContentHashFromMessage,
  normalizeHexHashToken,
  normalizeProviderHashValue,
  shouldCaptureMediaAfterIngest,
} from "./sticker-dedupe";

test("normalizeProviderHashValue supports byte and base64 inputs", () => {
  assert.equal(normalizeProviderHashValue(new Uint8Array([0xab, 0xcd, 0x01])), "abcd01");
  assert.equal(normalizeProviderHashValue("q80B"), "abcd01");
  assert.equal(normalizeProviderHashValue("ABCD01"), "abcd01");
  assert.equal(normalizeProviderHashValue("not-a-hash"), undefined);
  assert.equal(normalizeHexHashToken(" ABcd01 "), "abcd01");
  assert.equal(normalizeHexHashToken("abc"), undefined);
});

test("extractStickerProviderContentHashFromMessage reads direct sticker fileSha256", () => {
  const message = {
    message: {
      stickerMessage: {
        fileSha256: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      },
    },
  };
  assert.equal(extractStickerProviderContentHashFromMessage(message), "deadbeef");
});

test("extractStickerProviderContentHashFromMessage unwraps nested wrappers", () => {
  const message = {
    message: {
      ephemeralMessage: {
        message: {
          viewOnceMessage: {
            message: {
              stickerMessage: {
                fileSha256: "3q2+7w==",
              },
            },
          },
        },
      },
    },
  };
  assert.equal(extractStickerProviderContentHashFromMessage(message), "deadbeef");
});

test("shouldCaptureMediaAfterIngest short-circuits duplicates", () => {
  assert.equal(
    shouldCaptureMediaAfterIngest({
      duplicate: true,
      hasMediaKind: true,
      hasMessageId: true,
      shouldCaptureGroupMedia: true,
      isGroupThread: false,
    }),
    false,
  );

  assert.equal(
    shouldCaptureMediaAfterIngest({
      duplicate: false,
      hasMediaKind: true,
      hasMessageId: true,
      shouldCaptureGroupMedia: false,
      isGroupThread: true,
    }),
    false,
  );

  assert.equal(
    shouldCaptureMediaAfterIngest({
      duplicate: false,
      hasMediaKind: true,
      hasMessageId: true,
      shouldCaptureGroupMedia: false,
      isGroupThread: false,
    }),
    true,
  );
});
