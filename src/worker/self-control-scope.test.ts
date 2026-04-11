import assert from "node:assert/strict";
import test from "node:test";
import { isStrictSelfControlScope } from "./self-control-scope";

test("isStrictSelfControlScope accepts strict self-chat inbound", () => {
  assert.equal(
    isStrictSelfControlScope({
      selfAccount: "2348012345678",
      threadAccount: "2348012345678",
      senderAccount: "2348012345678",
      fromMe: false,
    }),
    true,
  );
});

test("isStrictSelfControlScope accepts fromMe self-chat even without sender account", () => {
  assert.equal(
    isStrictSelfControlScope({
      selfAccount: "2348012345678",
      threadAccount: "2348012345678",
      senderAccount: "",
      fromMe: true,
    }),
    true,
  );
});

test("isStrictSelfControlScope rejects third-party DMs", () => {
  assert.equal(
    isStrictSelfControlScope({
      selfAccount: "2348012345678",
      threadAccount: "15551234567",
      senderAccount: "2348012345678",
      fromMe: true,
    }),
    false,
  );
  assert.equal(
    isStrictSelfControlScope({
      selfAccount: "2348012345678",
      threadAccount: "15551234567",
      senderAccount: "15551234567",
      fromMe: false,
    }),
    false,
  );
});

test("isStrictSelfControlScope accepts alternate self aliases", () => {
  assert.equal(
    isStrictSelfControlScope({
      selfAccounts: ["2348012345678", "247953243545784"],
      threadAccount: "247953243545784",
      senderAccount: "",
      fromMe: true,
    }),
    true,
  );
  assert.equal(
    isStrictSelfControlScope({
      selfAccounts: ["2348012345678", "247953243545784"],
      threadAccount: "247953243545784",
      senderAccount: "2348012345678",
      fromMe: false,
    }),
    true,
  );
});
