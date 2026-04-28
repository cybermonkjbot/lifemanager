"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: "default" | "wide";
  children: ReactNode;
};

export type ModalTab = {
  id: string;
  label: string;
  badge?: string | number;
  content: ReactNode;
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function getFocusableElements(container: HTMLElement | null) {
  if (!container) {
    return [];
  }

  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && !element.hasAttribute("aria-hidden");
  });
}

export function UIModal({ open, onClose, title, description, size = "default", children }: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) {
      dialog.showModal();
    }

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Tab") {
        return;
      }

      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;

      if (event.shiftKey) {
        if (!active || active === first || !focusable.includes(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    const body = dialog.querySelector<HTMLElement>(".ui-modal-body");
    const focusable = getFocusableElements(body ?? dialog);
    const initialFocus = focusable[0] ?? dialog;
    initialFocus.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      if (dialog.open) {
        dialog.close();
      }
      if (previouslyFocusedRef.current && document.contains(previouslyFocusedRef.current)) {
        previouslyFocusedRef.current.focus();
      }
      previouslyFocusedRef.current = null;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const onDialogClick = (event: ReactMouseEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const clickedInDialog =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    if (!clickedInDialog) {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className={`ui-modal ${size === "wide" ? "ui-modal-wide" : ""}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={onDialogClick}
    >
      <div className="ui-modal-header">
        <div className="ui-modal-title-group">
          <h2 id={titleId}>{title}</h2>
          {description ? (
            <p id={descriptionId} className="ui-modal-description">
              {description}
            </p>
          ) : null}
        </div>
        <button type="button" className="ui-modal-close" onClick={onClose} aria-label="Close dialog" title="Close">
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="M5.5 5.5L14.5 14.5M14.5 5.5L5.5 14.5" />
          </svg>
        </button>
      </div>
      <div className="ui-modal-body">{children}</div>
    </dialog>
  );
}

type ModalTabsProps = {
  tabs: ModalTab[];
  defaultTabId?: string;
  label: string;
};

export function ModalTabs({ tabs, defaultTabId, label }: ModalTabsProps) {
  const baseId = useId();
  const [activeTabId, setActiveTabId] = useState(() => defaultTabId ?? tabs[0]?.id ?? "");
  const activeTab = tabs.some((tab) => tab.id === activeTabId) ? activeTabId : tabs[0]?.id ?? "";

  if (tabs.length === 0) {
    return null;
  }

  const focusTab = (index: number) => {
    const nextTab = tabs[index];
    if (!nextTab) {
      return;
    }
    setActiveTabId(nextTab.id);
    window.requestAnimationFrame(() => {
      document.getElementById(`${baseId}-tab-${nextTab.id}`)?.focus();
    });
  };

  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusTab((index + 1) % tabs.length);
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusTab((index - 1 + tabs.length) % tabs.length);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      focusTab(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      focusTab(tabs.length - 1);
    }
  };

  return (
    <div className="ui-modal-tabbed">
      <div className="ui-modal-tabs queue-focus-tabs" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => {
          const selected = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              id={`${baseId}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              className={`btn ${selected ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setActiveTabId(tab.id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
            >
              {tab.label}
              {tab.badge !== undefined ? <span className="ui-modal-tab-badge">{tab.badge}</span> : null}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${baseId}-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          hidden={tab.id !== activeTab}
          className="ui-modal-tab-panel"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
