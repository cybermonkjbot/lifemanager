import { createConvexClient } from "@/lib/convex-server";
import { convexRefs } from "@/lib/convex-refs";
import { requireInstanceApiAccess } from "@/lib/instance-guard";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ThreadMessage = {
  _id?: string;
  direction?: "inbound" | "outbound";
  messageAt?: number;
};

type RuntimeSettings = {
  quietHoursEnabled?: boolean;
  quietHoursStartHour?: number;
  quietHoursEndHour?: number;
};

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readBoolean(value: unknown) {
  return value === true;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizeHour(value: unknown, fallback: number) {
  const numberValue = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(0, Math.min(23, numberValue));
}

function isWithinHourWindow(nowHour: number, startHour: number, endHour: number) {
  if (startHour === endHour) {
    return false;
  }
  if (startHour < endHour) {
    return nowHour >= startHour && nowHour < endHour;
  }
  return nowHour >= startHour || nowHour < endHour;
}

function nextHourWindowEndMs(nowMs: number, startHour: number, endHour: number) {
  const now = new Date(nowMs);
  const end = new Date(nowMs);
  end.setHours(endHour, 0, 0, 0);
  if (startHour > endHour && now.getHours() >= startHour) {
    end.setDate(end.getDate() + 1);
  }
  if (end.getTime() <= nowMs) {
    end.setDate(end.getDate() + 1);
  }
  return end.getTime();
}

function quietHoursPolicy(settings: RuntimeSettings | null) {
  const now = Date.now();
  const startHour = normalizeHour(settings?.quietHoursStartHour, 23);
  const endHour = normalizeHour(settings?.quietHoursEndHour, 7);
  const enabled = settings?.quietHoursEnabled === true;
  const active = enabled && isWithinHourWindow(new Date(now).getHours(), startHour, endHour);
  const nextAllowedAt = active ? nextHourWindowEndMs(now, startHour, endHour) : null;
  return {
    enabled,
    active,
    startHour,
    endHour,
    nextAllowedAt,
  };
}

function findSourceMessageId(threadData: unknown) {
  const messages = Array.isArray(asRecord(threadData).messages) ? (asRecord(threadData).messages as ThreadMessage[]) : [];
  const sortedMessages = [...messages].sort((left, right) => (left.messageAt || 0) - (right.messageAt || 0));
  const latestInbound = [...sortedMessages].reverse().find((message) => message.direction === "inbound" && readString(message._id));
  const latestMessage = [...sortedMessages].reverse().find((message) => readString(message._id));
  return readString(latestInbound?._id || latestMessage?._id);
}

export async function GET(request: Request) {
  const unauthorized = await requireInstanceApiAccess(request, "json");
  if (unauthorized) {
    return unauthorized;
  }

  const convex = createConvexClient();
  const settings = (await convex.query(convexRefs.settingsGet, {}).catch(() => null)) as RuntimeSettings | null;
  return NextResponse.json({
    ok: true,
    quietHours: quietHoursPolicy(settings),
  });
}

export async function POST(request: Request) {
  const unauthorized = await requireInstanceApiAccess(request, "json");
  if (unauthorized) {
    return unauthorized;
  }

  const body = asRecord(await request.json().catch(() => null));
  const threadId = readString(body.threadId);
  const title = readString(body.title) || "this contact";
  const previewText = readString(body.previewText);
  const messageIntent = readString(body.messageIntent) || "Approved from Ask Odogwu HQ";
  const ignoreQuietHours = readBoolean(body.ignoreQuietHours);

  if (!threadId) {
    return NextResponse.json({ error: "Missing threadId for this preview." }, { status: 400 });
  }
  if (!previewText) {
    return NextResponse.json({ error: `Missing preview text for ${title}.` }, { status: 400 });
  }
  if (previewText.length > 5000) {
    return NextResponse.json({ error: `Preview for ${title} is too long to send safely.` }, { status: 400 });
  }

  const convex = createConvexClient();
  const settings = (await convex.query(convexRefs.settingsGet, {}).catch(() => null)) as RuntimeSettings | null;
  const quietHours = quietHoursPolicy(settings);
  const scheduledForQuietHours = quietHours.active && !ignoreQuietHours && quietHours.nextAllowedAt ? quietHours.nextAllowedAt : null;
  const threadData = await convex
    .query(convexRefs.threadGet, {
      threadId,
      includeStatusMessages: false,
    })
    .catch(() => null);
  const sourceMessageId = findSourceMessageId(threadData);

  if (!sourceMessageId) {
    return NextResponse.json({ error: `Could not find a source message for ${title}. Open the thread and send from there.` }, { status: 400 });
  }

  const result = await convex.mutation(convexRefs.draftSaveOrReplacePending, {
    threadId,
    sourceMessageId,
    text: previewText,
    provider: "azure",
    confidence: 0.82,
    delayMs: scheduledForQuietHours ? Math.max(0, scheduledForQuietHours - Date.now()) : 0,
    typingMs: 0,
    sendKind: "text",
    reason: `Ask Odogwu HQ approved preview${scheduledForQuietHours ? " (scheduled after quiet hours)" : ""}: ${messageIntent}`.slice(0, 240),
    toolRunId: `home-preview:${ignoreQuietHours ? "ignore-quiet-hours" : "respect-quiet-hours"}:${Date.now()}:${Math.random()
      .toString(36)
      .slice(2, 8)}`,
  });

  return NextResponse.json({
    ok: true,
    title,
    quietHours: {
      ...quietHours,
      ignored: quietHours.active && ignoreQuietHours,
      scheduledFor: scheduledForQuietHours,
    },
    result,
  });
}
