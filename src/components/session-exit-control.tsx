"use client";

import { UIModal } from "@/components/ui-modal";
import { useState } from "react";

type SessionExitModalProps = {
  open: boolean;
  onClose: () => void;
};

type SessionExitControlProps = {
  className?: string;
  iconOnly?: boolean;
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
        Lock only sends you back to the unlock screen. Disconnect apps also removes saved WhatsApp, Instagram, iMessage, and Telegram access from this device where applicable, so reconnecting will require setup again.
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

export function SessionExitControl({ className, iconOnly = true, label = "Log out" }: SessionExitControlProps) {
  const [open, setOpen] = useState(false);
  const buttonClassName = className ?? (iconOnly ? "btn btn-ghost btn-icon" : "btn btn-ghost");

  return (
    <>
      <button type="button" className={buttonClassName} onClick={() => setOpen(true)} aria-label={label} title={label}>
        {iconOnly ? (
          <>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                fill="currentColor"
                d="M5.75 4A1.75 1.75 0 0 0 4 5.75v12.5C4 19.216 4.784 20 5.75 20h6.5A1.75 1.75 0 0 0 14 18.25v-2a.75.75 0 0 0-1.5 0v2a.25.25 0 0 1-.25.25h-6.5a.25.25 0 0 1-.25-.25V5.75a.25.25 0 0 1 .25-.25h6.5a.25.25 0 0 1 .25.25v2a.75.75 0 0 0 1.5 0v-2A1.75 1.75 0 0 0 12.25 4h-6.5Zm11.72 4.97a.75.75 0 0 1 1.06 0l2.5 2.5a.75.75 0 0 1 0 1.06l-2.5 2.5a.75.75 0 1 1-1.06-1.06l1.22-1.22H9.75a.75.75 0 0 1 0-1.5h8.94l-1.22-1.22a.75.75 0 0 1 0-1.06Z"
              />
            </svg>
            <span className="sr-only">{label}</span>
          </>
        ) : (
          label
        )}
      </button>
      <SessionExitModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
