"use client";

import type { ActionNotice } from "@/lib/ui/action-state";

type ActionNoticesProps = {
  notices: ActionNotice[];
  onDismiss: (id: string) => void;
};

export function ActionNotices({ notices, onDismiss }: ActionNoticesProps) {
  if (notices.length === 0) {
    return null;
  }

  return (
    <div className="action-notices" aria-live="polite" aria-atomic="false">
      {notices.map((notice) => (
        <div key={notice.id} className={`action-notice action-notice-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          <p>{notice.message}</p>
          <button
            type="button"
            className="action-notice-dismiss"
            onClick={() => onDismiss(notice.id)}
            aria-label="Dismiss notification"
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
