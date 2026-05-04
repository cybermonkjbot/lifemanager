"use client";

import { UIModal } from "@/components/ui-modal";
import { useEffect, useState } from "react";

type ConfirmTone = "default" | "danger";

export type AppConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
};

type ConfirmRequest = {
  options: AppConfirmOptions;
  resolve: (confirmed: boolean) => void;
};

const CONFIRM_EVENT = "lifemanager:confirm";

export function confirmAppDialog(options: string | AppConfirmOptions) {
  const normalizedOptions = typeof options === "string" ? { message: options } : options;

  if (typeof window === "undefined") {
    return Promise.resolve(false);
  }

  return new Promise<boolean>((resolve) => {
    window.dispatchEvent(
      new CustomEvent<ConfirmRequest>(CONFIRM_EVENT, {
        detail: {
          options: normalizedOptions,
          resolve,
        },
      }),
    );
  });
}

export function AppConfirmDialogHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  useEffect(() => {
    const onConfirmRequest = (event: Event) => {
      const customEvent = event as CustomEvent<ConfirmRequest>;
      setRequest(customEvent.detail);
    };

    window.addEventListener(CONFIRM_EVENT, onConfirmRequest);
    return () => window.removeEventListener(CONFIRM_EVENT, onConfirmRequest);
  }, []);

  const close = (confirmed: boolean) => {
    const currentRequest = request;
    setRequest(null);
    currentRequest?.resolve(confirmed);
  };

  const options = request?.options;
  const isDanger = options?.tone === "danger";

  return (
    <UIModal
      open={Boolean(request)}
      onClose={() => close(false)}
      title={options?.title ?? "Confirm action"}
      description={options?.message}
    >
      <div className="admin-modal-actions">
        <button type="button" className="btn btn-ghost" onClick={() => close(false)}>
          {options?.cancelLabel ?? "Cancel"}
        </button>
        <button type="button" className={`btn ${isDanger ? "btn-danger-ghost" : "btn-primary"}`} onClick={() => close(true)}>
          {options?.confirmLabel ?? "OK"}
        </button>
      </div>
    </UIModal>
  );
}
