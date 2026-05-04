import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTenantConnectorEnabled,
  connectorPlanUnavailableMessage,
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
    "Your trial has ended. Choose a plan to keep using hosted features.",
  );
});

test("billing access blocks active subscriptions after their explicit expiry", () => {
  assert.equal(isTenantBillingActive({ billingStatus: "active", trialEndsAt: 0, subscriptionExpiresAt: now + 1 }, now), true);
  assert.equal(isTenantBillingActive({ billingStatus: "active", trialEndsAt: 0, subscriptionExpiresAt: now }, now), false);
  assert.equal(
    tenantBillingInactiveReason({ billingStatus: "active", trialEndsAt: 0, subscriptionExpiresAt: now }, now),
    "Your subscription has ended. Restore billing to keep using hosted features.",
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

test("connector entitlement defaults include personal local connectors", async () => {
  assert.equal(await isTenantConnectorEnabled(mockCtx(), activePersonal, "whatsapp"), true);
  assert.equal(await isTenantConnectorEnabled(mockCtx(), activePersonal, "instagram"), false);
  assert.equal(await isTenantConnectorEnabled(mockCtx(), activePersonal, "imessage"), true);
  assert.equal(await isTenantConnectorEnabled(mockCtx(), activePersonal, "telegram"), true);
});

test("connector entitlement defaults allow all connectors for self-hosted tenants", async () => {
  const business: TenantBillingSnapshot = { ...activePersonal, plan: "business_whatsapp" };
  const selfHosted: TenantBillingSnapshot = { ...activePersonal, plan: "self_hosted", serviceMode: "self_hosted" };

  assert.equal(await isTenantConnectorEnabled(mockCtx(), business, "instagram"), true);
  assert.equal(await isTenantConnectorEnabled(mockCtx(), business, "imessage"), true);
  assert.equal(await isTenantConnectorEnabled(mockCtx(), business, "telegram"), true);
  assert.equal(await isTenantConnectorEnabled(mockCtx(), selfHosted, "instagram"), true);
  assert.equal(await isTenantConnectorEnabled(mockCtx(), selfHosted, "imessage"), true);
  assert.equal(await isTenantConnectorEnabled(mockCtx(), selfHosted, "telegram"), true);
});

test("connector entitlement config overrides provider defaults", async () => {
  assert.equal(await isTenantConnectorEnabled(mockCtx("false"), activePersonal, "whatsapp"), false);
  assert.equal(await isTenantConnectorEnabled(mockCtx("true"), activePersonal, "telegram"), true);
  assert.equal(await isTenantConnectorEnabled(mockCtx("true"), activePersonal, "imessage"), true);
});

test("assertTenantConnectorEnabled blocks disabled providers", async () => {
  await assert.rejects(
    () => assertTenantConnectorEnabled(mockCtx("false"), activePersonal, "telegram"),
    /Telegram isn't included in this account's current plan/,
  );
  await assert.doesNotReject(() => assertTenantConnectorEnabled(mockCtx(), activePersonal, "telegram"));
});

test("connector plan unavailable message stays customer-facing", () => {
  assert.equal(
    connectorPlanUnavailableMessage("imessage"),
    "iMessage isn't included in this account's current plan. Contact support if you think you should have access.",
  );
});

test("tenant connector provider parsing ignores non-connector scopes", () => {
  assert.equal(asConnectorProvider("telegram"), "telegram" satisfies ConnectorProvider);
  assert.equal(asConnectorProvider("imessage"), "imessage" satisfies ConnectorProvider);
  assert.equal(asConnectorProvider("all"), undefined);
  assert.equal(asConnectorProvider("azure"), undefined);
  assert.equal(asConnectorProvider(undefined), undefined);
});
