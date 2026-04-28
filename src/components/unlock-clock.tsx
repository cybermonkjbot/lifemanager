"use client";

import { useEffect, useState } from "react";

type UnlockClockProps = {
  initialNowIso: string;
  initialTime: string;
  initialDate: string;
};

function formatClock(date: Date) {
  return {
    nowIso: date.toISOString(),
    time: new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date),
    date: new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(date),
  };
}

export function UnlockClock({ initialNowIso, initialTime, initialDate }: UnlockClockProps) {
  const [display, setDisplay] = useState(() => ({
    nowIso: initialNowIso,
    time: initialTime,
    date: initialDate,
  }));

  useEffect(() => {
    const tick = window.setInterval(() => setDisplay(formatClock(new Date())), 15_000);
    return () => window.clearInterval(tick);
  }, []);

  return (
    <div className="instance-lock-clock" aria-live="polite">
      <time dateTime={display.nowIso} className="instance-lock-time">
        {display.time}
      </time>
      <p>{display.date}</p>
    </div>
  );
}
