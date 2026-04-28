"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AdminMasqueradeBanner } from "@/components/admin-masquerade-banner";
import { AdminConsoleShell } from "@/components/admin-console-shell";
import { UIModal } from "@/components/ui-modal";
import type { AdminMasqueradeSession } from "@/lib/admin-masquerade";

type SecretStatus = {
  key: string;
  label: string;
  description: string;
  envNames: string[];
  secret: boolean;
  configuredInConvex: boolean;
  envFallbackConfigured: boolean;
  valuePreview: string;
  updatedAt: number | null;
  updatedBy: string;
};

type Notice = {
  kind: "info" | "error";
  message: string;
};

async function readJson(response: Response) {
  return (await response.json()) as {
    secrets?: SecretStatus[];
    error?: string;
  };
}

type AdminSecretsDashboardProps = {
  masqueradeSession?: AdminMasqueradeSession | null;
};

type AdminSecretUpdateModalProps = {
  selectedSecret: SecretStatus | null;
  draftValue: string;
  pendingKey: string;
  onChange: (key: string, value: string) => void;
  onClose: () => void;
  onSave: (key: string) => void;
};

function AdminSecretUpdateModal({
  selectedSecret,
  draftValue,
  pendingKey,
  onChange,
  onClose,
  onSave,
}: AdminSecretUpdateModalProps) {
  return (
    <UIModal
      open={Boolean(selectedSecret)}
      onClose={onClose}
      title={selectedSecret ? `Update ${selectedSecret.label}` : "Update Secret"}
    >
      {selectedSecret ? (
        <div className="admin-modal-form">
          <label>
            <span>{selectedSecret.secret ? "Secret value" : "Config value"}</span>
            <input
              type={selectedSecret.secret ? "password" : "text"}
              value={draftValue}
              placeholder={selectedSecret.secret ? "New secret value" : "New config value"}
              onChange={(event) => onChange(selectedSecret.key, event.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="admin-modal-actions">
            <button className="btn btn-ghost" type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={!draftValue.trim() || pendingKey === selectedSecret.key}
              onClick={() => onSave(selectedSecret.key)}
            >
              {pendingKey === selectedSecret.key ? "Saving..." : "Save value"}
            </button>
          </div>
        </div>
      ) : null}
    </UIModal>
  );
}

type AdminSecretClearModalProps = {
  clearingSecret: SecretStatus | null;
  pendingKey: string;
  onClose: () => void;
  onClear: (key: string) => void;
};

function AdminSecretClearModal({ clearingSecret, pendingKey, onClose, onClear }: AdminSecretClearModalProps) {
  return (
    <UIModal
      open={Boolean(clearingSecret)}
      onClose={onClose}
      title={clearingSecret ? `Clear ${clearingSecret.label}` : "Clear Secret"}
      description="This removes the stored value until a new one is saved."
    >
      <p className="ui-modal-confirmation-copy">
        Clear this value from the admin runtime configuration?
      </p>
      <div className="admin-modal-actions">
        <button className="btn btn-ghost" type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-danger-ghost"
          type="button"
          disabled={!clearingSecret || pendingKey === clearingSecret.key}
          onClick={() => clearingSecret ? onClear(clearingSecret.key) : undefined}
        >
          {clearingSecret && pendingKey === clearingSecret.key ? "Clearing..." : "Clear value"}
        </button>
      </div>
    </UIModal>
  );
}

export function AdminSecretsDashboard({ masqueradeSession }: AdminSecretsDashboardProps) {
  const [secrets, setSecrets] = useState<SecretStatus[]>([]);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pendingKey, setPendingKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [secretEditKey, setSecretEditKey] = useState("");
  const [clearSecretKey, setClearSecretKey] = useState("");
  const initialLoadRef = useRef(false);

  const selectedSecret = secrets.find((secret) => secret.key === secretEditKey) || null;
  const clearingSecret = secrets.find((secret) => secret.key === clearSecretKey) || null;

  const headers = useCallback(() => ({
    "content-type": "application/json",
  }), []);

  const loadSecrets = useCallback(async (options: { quiet?: boolean } = {}) => {
    setLoading(true);
    if (!options.quiet) {
      setNotice(null);
    }
    try {
      const response = await fetch("/api/admin/managed-secrets", {
        cache: "no-store",
        headers: headers(),
      });
      const body = await readJson(response);
      if (!response.ok || !body.secrets) {
        throw new Error(body.error || `Failed to load secrets (${response.status})`);
      }
      setSecrets(body.secrets);
      if (!options.quiet) {
        setNotice({ kind: "info", message: "Managed secret status loaded." });
      }
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Failed to load secrets." });
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    if (initialLoadRef.current) {
      return;
    }
    initialLoadRef.current = true;
    void loadSecrets({ quiet: true });
  }, [loadSecrets]);

  const saveSecret = async (key: string) => {
    setPendingKey(key);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/managed-secrets", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ key, value: draftValues[key] || "" }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        throw new Error(body.error || `Failed to save ${key}`);
      }
      setDraftValues((current) => ({ ...current, [key]: "" }));
      setSecretEditKey("");
      setNotice({ kind: "info", message: "Secret saved to Convex storage." });
      await loadSecrets();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Failed to save secret." });
    } finally {
      setPendingKey("");
    }
  };

  const clearSecret = async (key: string) => {
    setPendingKey(key);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/managed-secrets", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ key, clear: true }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        throw new Error(body.error || `Failed to clear ${key}`);
      }
      setClearSecretKey("");
      setNotice({ kind: "info", message: "Convex stored value cleared. Env fallback may still apply." });
      await loadSecrets();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Failed to clear secret." });
    } finally {
      setPendingKey("");
    }
  };

  return (
    <AdminConsoleShell>
        {masqueradeSession ? <AdminMasqueradeBanner session={masqueradeSession} /> : null}
        <header className="admin-console-header">
          <div>
            <p className="admin-kicker">Runtime Configuration</p>
            <h1>Managed Secrets</h1>
            <p>Review provider credentials, Convex stored values, environment fallbacks, and update status.</p>
          </div>
          <button className="btn btn-primary admin-primary-action" type="button" disabled={loading} onClick={() => void loadSecrets()}>
            {loading ? "Refreshing..." : "Refresh secrets"}
          </button>
        </header>

        {notice ? (
          <p className={notice.kind === "error" ? "admin-alert" : "admin-notice"} role={notice.kind === "error" ? "alert" : "status"}>
            {notice.message}
          </p>
        ) : null}

        <div className="admin-data-panel">
          <div className="admin-data-head admin-secret-head">
            <span>Secret</span>
            <span>Storage</span>
            <span>Update</span>
          </div>
          <div className="admin-data-list">
            {secrets.map((secret) => (
              <article key={secret.key} className="admin-data-row admin-secret-row">
                <div>
                  <strong>{secret.label}</strong>
                  <span>{secret.description}</span>
                  <span>{secret.envNames.join(", ")}</span>
                </div>
                <div>
                  <strong>{secret.configuredInConvex ? "Convex encrypted" : "No Convex value"}</strong>
                  <span>{secret.envFallbackConfigured ? "Env fallback available" : "No env fallback"}</span>
                  {secret.valuePreview ? <span>{secret.valuePreview}</span> : null}
                </div>
                <div className="admin-secret-actions">
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={pendingKey === secret.key}
                    onClick={() => setSecretEditKey(secret.key)}
                  >
                    Update
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    disabled={pendingKey === secret.key || !secret.configuredInConvex}
                    onClick={() => setClearSecretKey(secret.key)}
                  >
                    Clear
                  </button>
                </div>
              </article>
            ))}
            {secrets.length === 0 ? <p className="admin-empty-state">{loading ? "Loading secret status..." : "No secret definitions found."}</p> : null}
          </div>
        </div>

      <AdminSecretUpdateModal
        selectedSecret={selectedSecret}
        draftValue={selectedSecret ? draftValues[selectedSecret.key] || "" : ""}
        pendingKey={pendingKey}
        onChange={(key, value) => setDraftValues((current) => ({ ...current, [key]: value }))}
        onClose={() => setSecretEditKey("")}
        onSave={(key) => void saveSecret(key)}
      />

      <AdminSecretClearModal
        clearingSecret={clearingSecret}
        pendingKey={pendingKey}
        onClose={() => setClearSecretKey("")}
        onClear={(key) => void clearSecret(key)}
      />

    </AdminConsoleShell>
  );
}
