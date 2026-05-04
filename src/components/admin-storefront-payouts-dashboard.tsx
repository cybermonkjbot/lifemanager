"use client";

import { useState } from "react";

export type StorefrontPayoutOps = {
  currency: string;
  availableNetAmount: number;
  availableEntryCount: number;
  tenantSummaries: Array<{
    tenantId?: string;
    netAmount: number;
    orderCount: number;
    payoutAccount?: {
      bankName: string;
      accountNumberMasked: string;
      accountName: string;
      kycStatus: "missing" | "submitted" | "verified" | "rejected";
      verificationNotes?: string;
    } | null;
  }>;
  draftBatches: Array<{
    _id: string;
    currency: string;
    status: string;
    totalGrossAmount?: number;
    totalFeeAmount?: number;
    totalNetAmount: number;
    tenantCount: number;
    orderCount: number;
    createdAt: number;
  }>;
};

function formatMoney(value: number, currency: string) {
  return `${currency} ${Math.round(value * 100) / 100}`;
}

async function readJson(response: Response, fallback: string) {
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) {
    throw new Error(body.error || fallback);
  }
  return body;
}

export function AdminStorefrontPayoutsDashboard({ initialOps }: { initialOps: StorefrontPayoutOps }) {
  const [ops] = useState(initialOps);
  const [pending, setPending] = useState(false);
  const [batchReference, setBatchReference] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function createBatch() {
    setPending(true);
    setNotice("");
    setError("");
    try {
      await readJson(
        await fetch("/api/admin/storefront-payouts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create_batch", currency: ops.currency, notes: "Weekend storefront payout batch." }),
        }),
        "Failed to create payout batch.",
      );
      setNotice("Payout batch created. Refresh to review it before marking paid.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create payout batch.");
    } finally {
      setPending(false);
    }
  }

  async function markPaid(batchId: string) {
    setPending(true);
    setNotice("");
    setError("");
    try {
      await readJson(
        await fetch("/api/admin/storefront-payouts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "mark_paid",
            batchId,
            externalReference: batchReference || undefined,
            notes: "Marked paid after weekend payout transfer.",
          }),
        }),
        "Failed to mark payout paid.",
      );
      setNotice("Payout batch marked paid. Refresh to see the updated ledger.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark payout paid.");
    } finally {
      setPending(false);
    }
  }

  async function verifyAccount(tenantId: string | undefined, status: "verified" | "rejected") {
    setPending(true);
    setNotice("");
    setError("");
    try {
      await readJson(
        await fetch("/api/admin/storefront-payouts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "verify_account",
            tenantId,
            status,
            notes: status === "verified" ? "Admin verified payout account for weekend transfers." : "Admin rejected payout account.",
          }),
        }),
        "Failed to update payout account.",
      );
      setNotice("Payout account updated. Refresh to see the latest status.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update payout account.");
    } finally {
      setPending(false);
    }
  }

  async function initiateTransfers(batchId: string) {
    setPending(true);
    setNotice("");
    setError("");
    try {
      const body = await readJson(
        await fetch("/api/admin/storefront-payouts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "initiate_transfers", batchId }),
        }),
        "Failed to initiate payout transfers.",
      ) as { initiated?: number };
      setNotice(`Flutterwave transfer initiation complete for ${body.initiated || 0} payout item(s). Refresh for transfer status.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initiate payout transfers.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="admin-config-stack">
      {error ? <p className="admin-alert" role="alert">{error}</p> : null}
      {notice ? <p className="admin-notice" role="status">{notice}</p> : null}
      <div className="admin-stat-grid">
        <div><span>Available Net</span><strong>{formatMoney(ops.availableNetAmount, ops.currency)}</strong></div>
        <div><span>Receivables</span><strong>{ops.availableEntryCount}</strong></div>
        <div><span>Tenants Due</span><strong>{ops.tenantSummaries.length}</strong></div>
        <div><span>Open Batches</span><strong>{ops.draftBatches.length}</strong></div>
      </div>

      <section className="admin-data-panel">
        <div className="admin-table-toolbar">
          <div>
            <span>Weekend payout queue</span>
            <strong>{ops.tenantSummaries.length} tenants ready</strong>
          </div>
          <button className="btn admin-primary-action" type="button" onClick={createBatch} disabled={pending || ops.availableEntryCount === 0}>
            {pending ? "Working..." : "Create weekend batch"}
          </button>
        </div>
        <div className="admin-data-head admin-billing-event-head">
          <span>Tenant</span>
          <span>Orders</span>
          <span>Net due</span>
          <span>Status</span>
        </div>
        <div className="admin-data-list">
          {ops.tenantSummaries.map((tenant) => (
            <article className="admin-data-row admin-billing-event-row" key={tenant.tenantId || "platform"}>
              <div><strong>{tenant.tenantId || "Self-hosted/local"}</strong><span>business tenant</span></div>
              <div><strong>{tenant.orderCount}</strong><span>paid orders</span></div>
              <div><strong>{formatMoney(tenant.netAmount, ops.currency)}</strong><span>weekend receivable</span></div>
              <div>
                <strong>{tenant.payoutAccount?.kycStatus || "missing payout"}</strong>
                <span>
                  {tenant.payoutAccount
                    ? `${tenant.payoutAccount.bankName} ${tenant.payoutAccount.accountNumberMasked}`
                    : "business must submit details"}
                </span>
                {tenant.payoutAccount?.kycStatus === "submitted" ? (
                  <button className="btn" type="button" onClick={() => void verifyAccount(tenant.tenantId, "verified")} disabled={pending}>
                    Verify
                  </button>
                ) : null}
              </div>
            </article>
          ))}
          {ops.tenantSummaries.length === 0 ? <p className="empty-line">No available merchant receivables yet.</p> : null}
        </div>
      </section>

      <section className="admin-data-panel">
        <div className="admin-table-toolbar">
          <div>
            <span>Open payout batches</span>
            <strong>Initiate Flutterwave transfers or use manual fallback after transfer is complete</strong>
          </div>
          <input
            className="input"
            value={batchReference}
            placeholder="Transfer reference"
            onChange={(event) => setBatchReference(event.target.value)}
          />
        </div>
        <div className="admin-data-head admin-billing-event-head">
          <span>Batch</span>
          <span>Tenants</span>
          <span>Net</span>
          <span>Action</span>
        </div>
        <div className="admin-data-list">
          {ops.draftBatches.map((batch) => (
            <article className="admin-data-row admin-billing-event-row" key={batch._id}>
              <div><strong>{batch._id}</strong><span>{new Date(batch.createdAt).toLocaleString()}</span></div>
              <div><strong>{batch.tenantCount}</strong><span>{batch.orderCount} orders</span></div>
              <div>
                <strong>{formatMoney(batch.totalNetAmount, batch.currency)}</strong>
                <span>
                  gross {formatMoney(batch.totalGrossAmount || 0, batch.currency)} · fee {formatMoney(batch.totalFeeAmount || 0, batch.currency)}
                </span>
              </div>
              <div>
                <button className="btn btn-primary" type="button" onClick={() => void initiateTransfers(batch._id)} disabled={pending || batch.status !== "draft"}>
                  Initiate transfers
                </button>
                <button className="btn" type="button" onClick={() => void markPaid(batch._id)} disabled={pending}>
                  Mark paid
                </button>
              </div>
            </article>
          ))}
          {ops.draftBatches.length === 0 ? <p className="empty-line">No draft payout batches.</p> : null}
        </div>
      </section>
    </section>
  );
}
