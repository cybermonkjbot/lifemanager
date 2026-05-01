import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const testDataDir = mkdtempSync(join(tmpdir(), "odogwu-instance-pin-test-"));
process.env.SLM_DATA_DIR = testDataDir;
process.env.SLM_DISABLE_LOCAL_INSTANCE_CONFIG = "1";

const {
  buildInstancePinSessionToken,
  isInstancePinEnabled,
  matchesInstancePin,
  normalizeInstanceNextPath,
  verifyInstancePinSessionToken,
} = await import("./instance-pin");

function restoreEnv(previous: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
}

test("instance pin helpers stay disabled when no PIN is configured", async () => {
  const previous = {
    SLM_INSTANCE_PIN: process.env.SLM_INSTANCE_PIN,
    SLM_INSTANCE_PIN_TTL_DAYS: process.env.SLM_INSTANCE_PIN_TTL_DAYS,
    SLM_INSTANCE_COOKIE_SECRET: process.env.SLM_INSTANCE_COOKIE_SECRET,
    SLM_DATA_DIR: process.env.SLM_DATA_DIR,
    SLM_DISABLE_LOCAL_INSTANCE_CONFIG: process.env.SLM_DISABLE_LOCAL_INSTANCE_CONFIG,
  };

  delete process.env.SLM_INSTANCE_PIN;
  delete process.env.SLM_INSTANCE_PIN_TTL_DAYS;
  delete process.env.SLM_INSTANCE_COOKIE_SECRET;

  try {
    assert.equal(await isInstancePinEnabled(), false);
    assert.equal(await matchesInstancePin("anything"), true);
    assert.equal(await verifyInstancePinSessionToken(undefined), true);
  } finally {
    restoreEnv(previous);
  }
});

test("instance pin session token verifies and rejects tampering or expiry in env mode", async () => {
  const previous = {
    SLM_INSTANCE_PIN: process.env.SLM_INSTANCE_PIN,
    SLM_INSTANCE_PIN_TTL_DAYS: process.env.SLM_INSTANCE_PIN_TTL_DAYS,
    SLM_INSTANCE_COOKIE_SECRET: process.env.SLM_INSTANCE_COOKIE_SECRET,
    SLM_DATA_DIR: process.env.SLM_DATA_DIR,
    SLM_DISABLE_LOCAL_INSTANCE_CONFIG: process.env.SLM_DISABLE_LOCAL_INSTANCE_CONFIG,
  };

  process.env.SLM_INSTANCE_PIN = "2468";
  process.env.SLM_INSTANCE_PIN_TTL_DAYS = "7";
  process.env.SLM_INSTANCE_COOKIE_SECRET = "test-secret";

  try {
    assert.equal(await isInstancePinEnabled(), true);
    assert.equal(await matchesInstancePin("2468"), true);
    assert.equal(await matchesInstancePin("1357"), false);

    const issuedAt = 1_700_000_000_000;
    const token = await buildInstancePinSessionToken(issuedAt);
    assert.equal(await verifyInstancePinSessionToken(token, issuedAt + 60_000), true);
    assert.equal(await verifyInstancePinSessionToken(`${token}x`, issuedAt + 60_000), false);
    assert.equal(await verifyInstancePinSessionToken(token, issuedAt + 8 * 24 * 60 * 60 * 1000), false);
  } finally {
    restoreEnv(previous);
  }
});

test("normalizeInstanceNextPath keeps only safe internal paths", () => {
  assert.equal(normalizeInstanceNextPath("/settings?tab=ai"), "/settings?tab=ai");
  assert.equal(normalizeInstanceNextPath("https://example.com"), "/");
  assert.equal(normalizeInstanceNextPath("//evil.example"), "/");
  assert.equal(normalizeInstanceNextPath("/unlock?next=/system"), "/");
  assert.equal(normalizeInstanceNextPath("/setup"), "/");
  assert.equal(normalizeInstanceNextPath("/api/auth/pin/logout"), "/");
});
