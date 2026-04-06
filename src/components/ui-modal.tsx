"use client";

import { ReactNode, useEffect, useId } from "react";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
};

export function UIModal({ open, onClose, title, description, children }: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="ui-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="ui-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ui-modal-header">
          <div>
            <h3 id={titleId}>{title}</h3>
            {description ? (
              <p id={descriptionId} className="queue-meta">
                {description}
              </p>
            ) : null}
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="ui-modal-body">{children}</div>
      </div>
    </div>
  );
}
