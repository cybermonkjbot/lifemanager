"use client";

import { UIModal } from "@/components/ui-modal";
import { useState } from "react";

type SessionExitModalProps = {
  open: boolean;
  onClose: () => void;
};

type SessionExitControlProps = {
  className?: string;
  label?: string;
};

export function SessionExitModal({ open, onClose }: SessionExitModalProps) {
  const [pendingMode, setPendingMode] = useState<"lock" | "nuke" | null>(null);

  return (
    <UIModal
      open={open}
      onClose={onClose}
      title="End this session?"
      description="Choose whether to keep your app connections ready for next time."
    >
      <p className="ui-modal-confirmation-copy">
        Lock only sends you back to the unlock screen. Disconnect apps also removes the saved WhatsApp and Instagram sessions from this device, so reconnecting will require setup again.
      </p>
      <div className="session-exit-actions">
        <form action="/api/auth/pin/logout" method="post">
          <input type="hidden" name="mode" value="lock" />
          <button
            type="submit"
            className="btn btn-ghost"
            disabled={pendingMode !== null}
            onClick={() => setPendingMode("lock")}
          >
            {pendingMode === "lock" ? "Locking..." : "Lock only"}
          </button>
        </form>
        <form action="/api/auth/pin/logout" method="post">
          <input type="hidden" name="mode" value="nuke" />
          <button
            type="submit"
            className="btn btn-danger-ghost"
            disabled={pendingMode !== null}
            onClick={() => setPendingMode("nuke")}
          >
            {pendingMode === "nuke" ? "Disconnecting..." : "Disconnect apps"}
          </button>
        </form>
      </div>
    </UIModal>
  );
}

export function SessionExitControl({ className = "btn btn-ghost", label = "Log out" }: SessionExitControlProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      <SessionExitModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
