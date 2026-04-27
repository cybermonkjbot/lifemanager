import assert from "node:assert/strict";
import test from "node:test";
import { hostedBillingIsActive } from "./billing-access";

const now = 1_000_000;

test("hosted billing access treats expired trials as inactive", () => {
  assert.equal(hostedBillingIsActive({ billingStatus: "trialing", trialEndsAt: now + 1 }, now), true);
  assert.equal(hostedBillingIsActive({ billingStatus: "trialing", trialEndsAt: now - 1 }, now), false);
});

test("hosted billing access treats expired paid plans as inactive when an expiry exists", () => {
  assert.equal(hostedBillingIsActive({ billingStatus: "active", subscriptionExpiresAt: now + 1 }, now), true);
  assert.equal(hostedBillingIsActive({ billingStatus: "active", subscriptionExpiresAt: now }, now), false);
});
