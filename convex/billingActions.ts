"use node";

import { createDecipheriv, createHash } from "node:crypto";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const getEncryptedSecretRef = makeFunctionReference<"query">("adminSecrets:getEncryptedInternal");
const buildTenantReportRef = makeFunctionReference<"query">("billing:buildTenantReport");
const listTenantsDueForReportsRef = makeFunctionReference<"query">("billing:listTenantsDueForReports");
const markTenantReportSentRef = makeFunctionReference<"mutation">("billing:markTenantReportSent");
const markSubscriptionEmailSentRef = makeFunctionReference<"mutation">("billing:markSubscriptionEmailSent");

type EncryptedManagedSecret = {
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  encryptedValue: string;
};

const ENV_FALLBACKS: Record<string, string[]> = {
  "resend.apiKey": ["RESEND_API_KEY"],
  "resend.fromEmail": ["RESEND_FROM_EMAIL", "ODOGWU_RESEND_FROM_EMAIL"],
};

function readEnv(key: string) {
  for (const envName of ENV_FALLBACKS[key] || []) {
    const value = process.env[envName]?.trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function managedSecretsKey() {
  return process.env.ODOGWU_MANAGED_SECRETS_KEY?.trim() || process.env.SLM_MANAGED_SECRETS_KEY?.trim() || "";
}

function decryptManagedSecret(payload: EncryptedManagedSecret, secret: string) {
  if (payload.algorithm !== "aes-256-gcm") {
    throw new Error("Unsupported managed secret encryption algorithm.");
  }
  const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.encryptedValue, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

async function resolveSecret(ctx: ActionCtx, key: string) {
  const secret = managedSecretsKey();
  if (secret) {
    try {
      const stored = await ctx.runQuery(getEncryptedSecretRef, { key }) as EncryptedManagedSecret | null;
      if (stored) {
        const value = decryptManagedSecret(stored, secret).trim();
        if (value) {
          return value;
        }
      }
    } catch {
      // Fall back to Convex environment variables below.
    }
  }
  return readEnv(key);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(value?: number) {
  return value ? new Date(value).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" }) : "not set";
}

async function sendEmail(ctx: ActionCtx, args: {
  to: string;
  subject: string;
  html: string;
  text: string;
}) {
  const apiKey = await resolveSecret(ctx, "resend.apiKey");
  const from = await resolveSecret(ctx, "resend.fromEmail");
  if (!apiKey || !from) {
    throw new Error("Resend API key and from email must be configured.");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend email failed (${response.status}): ${body.slice(0, 400)}`);
  }
  return await response.json();
}

export const sendSubscriptionEmail = internalAction({
  args: {
    tenantId: v.id("tenantAccounts"),
    kind: v.union(
      v.literal("subscription_active"),
      v.literal("subscription_canceled"),
      v.literal("subscription_paused"),
      v.literal("payment_failed"),
    ),
  },
  handler: async (ctx, args) => {
    const report = await ctx.runQuery(buildTenantReportRef, { tenantId: args.tenantId, now: Date.now() }) as {
      tenant: {
        email: string;
        displayName: string;
        plan: string;
        billingStatus: string;
        trialEndsAt: number;
        subscriptionExpiresAt?: number;
      };
    } | null;
    if (!report) {
      return false;
    }

    const titles = {
      subscription_active: "Your OdogwuHQ subscription is active",
      subscription_canceled: "Your OdogwuHQ subscription was canceled",
      subscription_paused: "Your OdogwuHQ workspace is paused",
      payment_failed: "Your OdogwuHQ payment needs attention",
    } as const;
    const body = {
      subscription_active: `Your ${report.tenant.plan.replace(/_/g, " ")} subscription is active through ${formatDate(report.tenant.subscriptionExpiresAt)}.`,
      subscription_canceled: "Your subscription has been canceled. Hosted connectors will stay unavailable until billing is restored.",
      subscription_paused: "Your workspace has been paused because the trial or paid subscription expired. Hosted login and connector access are now blocked until billing is restored.",
      payment_failed: "Flutterwave reported a payment issue. Please update your payment method to avoid service pause.",
    }[args.kind];

    await sendEmail(ctx, {
      to: report.tenant.email,
      subject: titles[args.kind],
      html: `<h1>${escapeHtml(titles[args.kind])}</h1><p>${escapeHtml(body)}</p><p>Status: ${escapeHtml(report.tenant.billingStatus)}</p>`,
      text: `${titles[args.kind]}\n\n${body}\n\nStatus: ${report.tenant.billingStatus}`,
    });
    await ctx.runMutation(markSubscriptionEmailSentRef, {
      tenantId: args.tenantId,
      kind: args.kind,
      sentAt: Date.now(),
    });
    return true;
  },
});

export const sendTenantReport = internalAction({
  args: {
    tenantId: v.id("tenantAccounts"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const report = await ctx.runQuery(buildTenantReportRef, { tenantId: args.tenantId, now }) as {
      tenant: {
        email: string;
        displayName: string;
        plan: string;
        billingStatus: string;
        trialEndsAt: number;
        subscriptionExpiresAt?: number;
      };
      windowStartAt: number;
      windowEndAt: number;
      metrics: {
        providerRuns: number;
        providerSuccess: number;
        providerErrors: number;
        outboundSent: number;
        estimatedCostUsd: number;
      };
      alerts: string[];
    } | null;
    if (!report) {
      return false;
    }
    const alertHtml = report.alerts.length
      ? `<ul>${report.alerts.map((alert) => `<li>${escapeHtml(alert)}</li>`).join("")}</ul>`
      : "<p>No major alerts were recorded this week.</p>";
    const subject = `Weekly OdogwuHQ tenant report: ${report.tenant.displayName}`;
    const text = [
      subject,
      `Window: ${formatDate(report.windowStartAt)} to ${formatDate(report.windowEndAt)}`,
      `Plan: ${report.tenant.plan}`,
      `Billing: ${report.tenant.billingStatus}`,
      `Provider runs: ${report.metrics.providerRuns}`,
      `Provider errors: ${report.metrics.providerErrors}`,
      `Outbound sent: ${report.metrics.outboundSent}`,
      `Estimated AI cost: $${report.metrics.estimatedCostUsd.toFixed(4)}`,
      report.alerts.length ? `Alerts:\n- ${report.alerts.join("\n- ")}` : "Alerts: none",
    ].join("\n");

    await sendEmail(ctx, {
      to: report.tenant.email,
      subject,
      html: `
        <h1>${escapeHtml(subject)}</h1>
        <p>${escapeHtml(formatDate(report.windowStartAt))} to ${escapeHtml(formatDate(report.windowEndAt))}</p>
        <table>
          <tr><td>Plan</td><td>${escapeHtml(report.tenant.plan)}</td></tr>
          <tr><td>Billing</td><td>${escapeHtml(report.tenant.billingStatus)}</td></tr>
          <tr><td>Provider runs</td><td>${report.metrics.providerRuns}</td></tr>
          <tr><td>Provider errors</td><td>${report.metrics.providerErrors}</td></tr>
          <tr><td>Outbound sent</td><td>${report.metrics.outboundSent}</td></tr>
          <tr><td>Estimated AI cost</td><td>$${report.metrics.estimatedCostUsd.toFixed(4)}</td></tr>
        </table>
        <h2>Alerts</h2>
        ${alertHtml}
      `,
      text,
    });
    await ctx.runMutation(markTenantReportSentRef, {
      tenantId: args.tenantId,
      sentAt: now,
    });
    return true;
  },
});

export const sendWeeklyTenantReports = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const due = await ctx.runQuery(listTenantsDueForReportsRef, {
      now: Date.now(),
      limit: args.limit,
    }) as Array<{ tenantId: Id<"tenantAccounts"> }>;
    for (const row of due) {
      await ctx.scheduler.runAfter(0, makeFunctionReference<"action">("billingActions:sendTenantReport"), {
        tenantId: row.tenantId,
      });
    }
    return { scheduled: due.length };
  },
});
