import assert from "node:assert/strict";
import test from "node:test";
import { gatewayApiKeyConfigured, requestHasGatewayApiKey } from "./api-gateway-auth";

function restoreEnv(previous: string | undefined) {
  if (previous === undefined) {
    delete process.env.SLM_API_GATEWAY_KEY;
    return;
  }

  process.env.SLM_API_GATEWAY_KEY = previous;
}

function makeHeaders(init: Record<string, string>) {
  return new Headers(init);
}

test("gateway auth stays disabled when no API key is configured", () => {
  const previous = process.env.SLM_API_GATEWAY_KEY;
  delete process.env.SLM_API_GATEWAY_KEY;

  try {
    assert.equal(gatewayApiKeyConfigured(), false);
    assert.equal(requestHasGatewayApiKey(makeHeaders({ authorization: "Bearer anything" })), false);
  } finally {
    restoreEnv(previous);
  }
});

test("gateway auth accepts bearer and x-api-key matches only for the configured secret", () => {
  const previous = process.env.SLM_API_GATEWAY_KEY;
  process.env.SLM_API_GATEWAY_KEY = "super-secret";

  try {
    assert.equal(gatewayApiKeyConfigured(), true);
    assert.equal(requestHasGatewayApiKey(makeHeaders({ authorization: "Bearer super-secret" })), true);
    assert.equal(requestHasGatewayApiKey(makeHeaders({ "x-api-key": "super-secret" })), true);
    assert.equal(requestHasGatewayApiKey(makeHeaders({ authorization: "Bearer wrong-secret" })), false);
    assert.equal(requestHasGatewayApiKey(makeHeaders({ "x-api-key": "wrong-secret" })), false);
  } finally {
    restoreEnv(previous);
  }
});
