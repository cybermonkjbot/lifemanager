export type TenantBillingSnapshot = {
  billingStatus: string;
  trialEndsAt: number;
  subscriptionExpiresAt?: number;
};

export function isTenantBillingActive(tenant: TenantBillingSnapshot, now = Date.now()) {
  if (tenant.billingStatus === "trialing") {
    return tenant.trialEndsAt >= now;
  }
  if (tenant.billingStatus === "active") {
    return typeof tenant.subscriptionExpiresAt !== "number" || tenant.subscriptionExpiresAt > now;
  }
  return false;
}

export function tenantBillingInactiveReason(tenant: TenantBillingSnapshot, now = Date.now()) {
  if (tenant.billingStatus === "trialing" && tenant.trialEndsAt < now) {
    return "Tenant trial has expired.";
  }
  if (tenant.billingStatus === "active" && typeof tenant.subscriptionExpiresAt === "number" && tenant.subscriptionExpiresAt <= now) {
    return "Tenant subscription has expired.";
  }
  return "Tenant subscription is not active.";
}
