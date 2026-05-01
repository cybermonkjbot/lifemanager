import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTenantConnectorEnabled,
  isTenantBillingActive,
  isTenantConnectorEnabled,
  tenantBillingInactiveReason,
  type ConnectorProvider,
  type TenantBillingSnapshot,
} from "./billingAccess";
import { asConnectorProvider } from "./tenantSecurity";

const now = 1_000_000;

function mockCtx(configValue?: string) {
  return {
    db: {
      query: () => ({
        withIndex: (_indexName: string, cb: (q: { eq: (field: string, value: string) => unknown }) => unknown) => {
          cb({
            eq: (_field, value) => value,
          });
          return {
            first: async () => (configValue === undefined ? null : { value: configValue }),
          };
        },
      }),
    },
  } as unknown as Parameters<typeof isTenantConnectorEnabled>[0];
}

const activePersonal: TenantBillingSnapshot = {
  serviceMode: "hosted",
  plan: "personal_connector",
  billingStatus: "active",
  trialEndsAt: 0,
};

test("billing access allows unexpired trials and blocks expired trials", () => {
  assert.equal(isTenantBillingActive({ billingStatus: "trialing", trialEndsAt: now + 1 }, now), true);
  assert.equal(isTenantBillingActive({ billingStatus: "trialing", trialEndsAt: now - 1 }, now), false);
  assert.equal(
    tenantBillingInactiveReason({ billingStatus: "trialing", trialEndsAt: now - 1 }, now),
    "Tenant trial has expired.",
  );
});

test("billing access blocks active subscriptions after their explicit expiry", () => {
  assert.equal(isTenantBillingActive({ billingStatus: "active", trialEndsAt: 0, subscriptionExpiresAt: now + 1 }, now), true);
  assert.equal(isTenantBillingActive({ billingStatus: "active", trialEndsAt: 0, subscriptionExpiresAt: now }, now), false);
  assert.equal(
    tenantBillingInactiveReason({ billingStatus: "active", trialEndsAt: 0, subscriptionExpiresAt: now }, now),
    "Tenant subscription has expired.",
  );
});

test("billing access keeps manual active tenants valid when no expiry is set", () => {
  assert.equal(isTenantBillingActive({ billingStatus: "active", trialEndsAt: 0 }, now), true);
});

test("billing access never pauses self-hosted tenants", () => {
  assert.equal(
    isTenantBillingActive(
      {
        serviceMode: "self_hosted",
        billingStatus: "canceled",
        trialEndsAt: now - 1,
        subscriptionExpiresAt: now - 1,
      },
      now,
    ),
    true,
  );
});

test("connector entitlement defaults keep WhatsApp on and new connectors off", async () => {
  assert.equal(await isTenantConnectorEnabled(mockCtx(), activePersonal, "whatsapp"), true);
  assert.equal(await isTenantConnectorEnabled(mockCtx(), activePersonal, "instagram"), false);
  assert.equal(await isTenantConnectorEnabled(mockCtx(), activePersonal, "imessage"), false);
  assert.equal(await isTenantConnectorEnabled(mockCtx(), activePersonal, "telegram"), false);
});

test("connector entitlement defaults allow Instagram for business and self-hosted plans only", async () => {
  const business: TenantBillingSnapshot = { ...activePersonal, plan: "business_whatsapp" };
  const selfHosted: TenantBillingSnapshot = { ...activePersonal, plan: "self_hosted", serviceMode: "self_hosted" };

  assert.equal(await isTenantConnectorEnabled(mockCtx(), business, "instagram"), true);
  assert.equal(await isTenantConnectorEnabled(mockCtx(), selfHosted, "instagram"), true);
  assert.equal(await isTenantConnectorEnabled(mockCtx(), selfHosted, "imessage"), false);
  assert.equal(await isTenantConnectorEnabled(mockCtx(), selfHosted, "telegram"), false);
});

test("connector entitlement config overrides provider defaults", async () => {
  assert.equal(await isTenantConnectorEnabled(mockCtx("false"), activePersonal, "whatsapp"), false);
  assert.equal(await isTenantConnectorEnabled(mockCtx("true"), activePersonal, "telegram"), true);
  assert.equal(await isTenantConnectorEnabled(mockCtx("true"), activePersonal, "imessage"), true);
});

test("assertTenantConnectorEnabled blocks disabled providers", async () => {
  await assert.rejects(
    () => assertTenantConnectorEnabled(mockCtx(), activePersonal, "telegram"),
    /telegram is disabled for this tenant plan/,
  );
  await assert.doesNotReject(() => assertTenantConnectorEnabled(mockCtx("true"), activePersonal, "telegram"));
});

test("tenant connector provider parsing ignores non-connector scopes", () => {
  assert.equal(asConnectorProvider("telegram"), "telegram" satisfies ConnectorProvider);
  assert.equal(asConnectorProvider("imessage"), "imessage" satisfies ConnectorProvider);
  assert.equal(asConnectorProvider("all"), undefined);
  assert.equal(asConnectorProvider("azure"), undefined);
  assert.equal(asConnectorProvider(undefined), undefined);
});
