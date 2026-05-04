import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionFromRequest } from "@/lib/admin-auth";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import { decryptManagedSecret, getConvexAdminSecret, type EncryptedManagedSecret } from "@/lib/managed-secret-crypto";
import { resolveManagedSecretValue } from "@/lib/managed-secrets-server";
import type { Id } from "../../../../../convex/_generated/dataModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PreparedPayoutTransfer = {
  batchItemId: string;
  amount: number;
  currency: string;
  reference: string;
  accountBank: string;
  encryptedAccountNumber?: EncryptedManagedSecret;
  bankName: string;
  accountName: string;
  narration: string;
  callbackUrl?: string;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}

function cleanBaseUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

function normalizeTransferStatus(value: unknown): "pending" | "processing" | "successful" | "failed" {
  const status = String(value || "").trim().toLowerCase();
  if (status === "successful" || status === "success" || status === "completed") {
    return "successful";
  }
  if (status === "failed" || status === "failure") {
    return "failed";
  }
  if (status === "new" || status === "pending") {
    return "pending";
  }
  return "processing";
}

export async function POST(request: NextRequest) {
  if (!getAdminSessionFromRequest(request, { requireSameOrigin: true })) {
    return unauthorized();
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      currency?: string;
      batchId?: string;
      tenantId?: string;
      status?: "submitted" | "verified" | "rejected";
      externalReference?: string;
      notes?: string;
    };
    if (body.action === "create_batch") {
      const batchId = await createConvexClient().mutation(convexRefs.storefrontAdminCreateWeekendPayoutBatch, {
        adminSecret: getConvexAdminSecret(),
        currency: body.currency || "NGN",
        notes: body.notes,
      });
      return NextResponse.json({ batchId });
    }
    if (body.action === "verify_account") {
      await createConvexClient().mutation(convexRefs.storefrontAdminSetPayoutAccountStatus, {
        adminSecret: getConvexAdminSecret(),
        tenantId: body.tenantId as Id<"tenantAccounts"> | undefined,
        status: body.status || "verified",
        notes: body.notes,
      });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "initiate_transfers") {
      if (!body.batchId) {
        throw new Error("Missing payout batch id.");
      }
      const secretKey = await resolveManagedSecretValue("flutterwave.secretKey");
      if (!secretKey) {
        throw new Error("Flutterwave secret key is required before initiating payouts.");
      }
      const baseUrl =
        cleanBaseUrl(await resolveManagedSecretValue("billing.redirectBaseUrl")) ||
        cleanBaseUrl(process.env.NEXT_PUBLIC_APP_URL || "") ||
        new URL(request.url).origin;
      const prepared = await createConvexClient().mutation(convexRefs.storefrontAdminPreparePayoutBatchTransfers, {
        adminSecret: getConvexAdminSecret(),
        batchId: body.batchId as Id<"storefrontPayoutBatches">,
        callbackUrl: `${baseUrl}/api/storefront/flutterwave/payout-webhook`,
      }) as { transfers: PreparedPayoutTransfer[] };
      const results = [];
      for (const transfer of prepared.transfers) {
        if (!transfer.encryptedAccountNumber) {
          await createConvexClient().mutation(convexRefs.storefrontAdminRecordPayoutTransferResult, {
            adminSecret: getConvexAdminSecret(),
            transferReference: transfer.reference,
            status: "failed",
            failureReason: "Encrypted payout account number is missing.",
          });
          results.push({ reference: transfer.reference, status: "failed" });
          continue;
        }
        const accountNumber = decryptManagedSecret(transfer.encryptedAccountNumber);
        const response = await fetch("https://api.flutterwave.com/v3/transfers", {
          method: "POST",
          headers: {
            authorization: `Bearer ${secretKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            account_bank: transfer.accountBank,
            account_number: accountNumber,
            amount: transfer.amount,
            currency: transfer.currency,
            narration: transfer.narration,
            reference: transfer.reference,
            callback_url: transfer.callbackUrl,
          }),
        });
        const payload = await response.json().catch(() => ({})) as {
          status?: string;
          message?: string;
          data?: { id?: string | number; status?: string; complete_message?: string };
        };
        const transferStatus = response.ok ? normalizeTransferStatus(payload.data?.status || payload.status) : "failed";
        await createConvexClient().mutation(convexRefs.storefrontAdminRecordPayoutTransferResult, {
          adminSecret: getConvexAdminSecret(),
          transferReference: transfer.reference,
          transferId: payload.data?.id ? String(payload.data.id) : undefined,
          status: transferStatus,
          failureReason: transferStatus === "failed" ? payload.data?.complete_message || payload.message || `Flutterwave transfer failed (${response.status}).` : undefined,
          providerPayloadSummary: JSON.stringify({
            status: payload.status,
            message: payload.message,
            transferStatus: payload.data?.status,
          }).slice(0, 1000),
        });
        results.push({ reference: transfer.reference, status: transferStatus });
      }
      return NextResponse.json({ initiated: results.length, results });
    }
    if (body.action === "mark_paid") {
      if (!body.batchId) {
        throw new Error("Missing payout batch id.");
      }
      const batchId = await createConvexClient().mutation(convexRefs.storefrontAdminMarkPayoutBatchPaid, {
        adminSecret: getConvexAdminSecret(),
        batchId: body.batchId,
        externalReference: body.externalReference,
        notes: body.notes,
      });
      return NextResponse.json({ batchId });
    }
    throw new Error("Unknown payout action.");
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update payouts." },
      { status: 400 },
    );
  }
}
