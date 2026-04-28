"use client";

import { useEffect, useMemo, useState } from "react";

export type UnlockActivityItem = {
  id: string;
  contact: string;
  action: string;
  tone: "active" | "queued" | "review" | "quiet";
};

type UnlockActivityHeaderProps = {
  items: UnlockActivityItem[];
};

const FALLBACK_ITEMS: UnlockActivityItem[] = [
  {
    id: "privacy",
    contact: "Private mode",
    action: "locked while background work continues",
    tone: "quiet",
  },
];

export function UnlockActivityHeader({ items }: UnlockActivityHeaderProps) {
  const activity = items.length ? items : FALLBACK_ITEMS;
  const [activeIndex, setActiveIndex] = useState(0);
  const activeItem = activity[activeIndex] || activity[0];

  useEffect(() => {
    if (activity.length < 2) {
      return;
    }
    const tick = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % activity.length);
    }, 3_800);
    return () => window.clearInterval(tick);
  }, [activity.length]);

  const activityCount = useMemo(() => activity.length, [activity.length]);

  return (
    <header className="instance-lock-activity" aria-label="Private background activity">
      <div className="instance-lock-activity-live">
        <span className={`instance-lock-activity-dot instance-lock-activity-dot-${activeItem.tone}`} />
        <span>Still running</span>
      </div>
      <div className="instance-lock-activity-current" aria-live="polite">
        <span>{activeItem.contact}</span>
        <em>{activeItem.action}</em>
      </div>
      {activityCount > 1 ? <div className="instance-lock-activity-count">{activityCount} private updates</div> : null}
    </header>
  );
}
