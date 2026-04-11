import assert from "node:assert/strict";
import test from "node:test";
import { parseOpenClawCommand } from "./openclaw-command";

test("parseOpenClawCommand parses status and help aliases", () => {
  assert.deepEqual(parseOpenClawCommand("openclaw"), {
    action: "status",
    raw: "openclaw",
  });
  assert.deepEqual(parseOpenClawCommand("openclaw status"), {
    action: "status",
    raw: "openclaw status",
  });
  assert.deepEqual(parseOpenClawCommand("claw ping"), {
    action: "status",
    raw: "claw ping",
  });
  assert.deepEqual(parseOpenClawCommand("/slm openclaw: health"), {
    action: "status",
    raw: "/slm openclaw: health",
  });
  assert.deepEqual(parseOpenClawCommand("openclaw help"), {
    action: "help",
    raw: "openclaw help",
  });
  assert.deepEqual(parseOpenClawCommand("@openclaw"), {
    action: "status",
    raw: "@openclaw",
  });
});

test("parseOpenClawCommand parses gateway forward requests", () => {
  assert.deepEqual(parseOpenClawCommand("openclaw summarize my unread threads"), {
    action: "forward",
    input: "summarize my unread threads",
    raw: "openclaw summarize my unread threads",
  });
  assert.deepEqual(parseOpenClawCommand("claw - run nightly triage"), {
    action: "forward",
    input: "run nightly triage",
    raw: "claw - run nightly triage",
  });
  assert.deepEqual(parseOpenClawCommand("yo @openclaw summarize inbox"), {
    action: "forward",
    input: "summarize inbox",
    raw: "yo @openclaw summarize inbox",
  });
  assert.deepEqual(parseOpenClawCommand("yo openclaw: summarize inbox"), {
    action: "forward",
    input: "summarize inbox",
    raw: "yo openclaw: summarize inbox",
  });
});

test("parseOpenClawCommand rejects non-command text", () => {
  assert.equal(parseOpenClawCommand("we should use openclaw soon"), null);
  assert.equal(parseOpenClawCommand(""), null);
  assert.equal(parseOpenClawCommand("open claw"), null);
});
