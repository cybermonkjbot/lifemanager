import assert from "node:assert/strict";
import test from "node:test";
import { shouldAttemptSelfControlOnUpsert } from "./self-control-routing";

test("shouldAttemptSelfControlOnUpsert allows live mode", () => {
  assert.equal(
    shouldAttemptSelfControlOnUpsert({
      ingestMode: null,
      upsertType: "notify",
      fromMe: false,
      messageAt: Date.now(),
    }),
    true,
  );
});

test("shouldAttemptSelfControlOnUpsert allows recent self append during ingest", () => {
  const now = Date.now();
  assert.equal(
    shouldAttemptSelfControlOnUpsert({
      ingestMode: "history_sync",
      upsertType: "append",
      fromMe: true,
      messageAt: now - 30_000,
      nowMs: now,
    }),
    true,
  );
});

test("shouldAttemptSelfControlOnUpsert rejects non-self or stale ingest events", () => {
  const now = Date.now();
  assert.equal(
    shouldAttemptSelfControlOnUpsert({
      ingestMode: "history_sync",
      upsertType: "append",
      fromMe: false,
      messageAt: now - 10_000,
      nowMs: now,
    }),
    false,
  );
  assert.equal(
    shouldAttemptSelfControlOnUpsert({
      ingestMode: "history_sync",
      upsertType: "append",
      fromMe: true,
      messageAt: now - 10 * 60 * 1000,
      nowMs: now,
    }),
    false,
  );
  assert.equal(
    shouldAttemptSelfControlOnUpsert({
      ingestMode: "history_fetch",
      upsertType: "notify",
      fromMe: true,
      messageAt: now - 10_000,
      nowMs: now,
    }),
    false,
  );
});
