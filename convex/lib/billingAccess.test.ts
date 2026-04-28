import assert from "node:assert/strict";
import test from "node:test";
import { isTenantBillingActive, tenantBillingInactiveReason } from "./billingAccess";

const now = 1_000_000;

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
