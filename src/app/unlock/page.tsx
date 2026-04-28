import { BrandLogo } from "@/components/brand-logo";
import { UnlockActivityHeader, type UnlockActivityItem } from "@/components/unlock-activity-header";
import { UnlockClock } from "@/components/unlock-clock";
import { UnlockForm } from "@/components/unlock-form";
import { queryQueue } from "@/lib/convex-server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  getInstancePinCookieName,
  isInstancePinEnabled,
  normalizeInstanceNextPath,
  resolveInstanceGateState,
  verifyInstancePinSessionToken,
} from "@/lib/instance-pin";
import {
  getTenantSessionCookieName,
  hasValidTenantSession,
} from "@/lib/tenant-session";

type UnlockPageProps = {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

function getSingleValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatInitialClock(now: Date) {
  return {
    initialNowIso: now.toISOString(),
    initialTime: new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(now),
    initialDate: new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(now),
  };
}

type LockQueueThread = {
  title?: string;
  jid?: string;
} | null;

type LockQueueData = {
  needsReply?: Array<{
    _id: string;
    thread?: LockQueueThread;
  }>;
  followupConfirmations?: Array<{
    _id: string;
    thread?: LockQueueThread;
  }>;
  todoCandidates?: Array<{
    _id: string;
    thread?: LockQueueThread;
  }>;
  guardrailFlags?: Array<{
    _id: string;
    thread?: LockQueueThread;
  }>;
};

function displayLockContact(value: string | undefined) {
  const normalized = (value || "").trim();
  if (!normalized) {
    return "a private contact";
  }
  const base = normalized
    .replace(/@s\.whatsapp\.net$/i, "")
    .replace(/@g\.us$/i, "")
    .replace(/\s+/g, " ");
  const words = base.split(" ").filter(Boolean);
  if (words.length > 1) {
    const first = words[0] || "";
    const secondInitial = words[1]?.[0] ? `${words[1][0].toUpperCase()}.` : "";
    return [first, secondInitial].filter(Boolean).join(" ");
  }
  if (base.includes("@")) {
    const [name, domain] = base.split("@");
    return `${name.slice(0, 2)}***@${domain?.split(".")[0] || "account"}`;
  }
  const digits = base.replace(/\D/g, "");
  if (digits.length >= 4) {
    return `contact ending ${digits.slice(-4)}`;
  }
  return base.length > 18 ? `${base.slice(0, 16)}...` : base;
}

function activityFromThread(
  id: string,
  thread: LockQueueThread,
  action: string,
  tone: UnlockActivityItem["tone"],
): UnlockActivityItem {
  return {
    id,
    contact: displayLockContact(thread?.title || thread?.jid),
    action,
    tone,
  };
}

async function loadLockActivity(): Promise<UnlockActivityItem[]> {
  const queue = await queryQueue().catch(() => null) as LockQueueData | null;
  if (!queue) {
    return [];
  }

  return [
    ...(queue.needsReply || []).slice(0, 3).map((item) =>
      activityFromThread(item._id, item.thread || null, "reply waiting for review", "review"),
    ),
    ...(queue.followupConfirmations || []).slice(0, 2).map((item) =>
      activityFromThread(item._id, item.thread || null, "follow-up queued", "queued"),
    ),
    ...(queue.todoCandidates || []).slice(0, 1).map((item) =>
      activityFromThread(item._id, item.thread || null, "task candidate captured", "queued"),
    ),
    ...(queue.guardrailFlags || []).slice(0, 1).map((item) =>
      activityFromThread(item._id, item.thread || null, "paused for safety review", "quiet"),
    ),
  ].slice(0, 5);
}

export default async function UnlockPage({ searchParams }: UnlockPageProps) {
  const gate = await resolveInstanceGateState();
  if (!gate.setupCompleted) {
    redirect("/setup");
  }

  if (!(await isInstancePinEnabled())) {
    redirect("/");
  }

  const params = searchParams ? await searchParams : {};
  const next = normalizeInstanceNextPath(getSingleValue(params.next));
  const emailParam = getSingleValue(params.email)?.trim().toLowerCase() || "";
  const hosted = gate.preferences.serviceMode === "hosted";
  const changingEmail = getSingleValue(params.change_email) === "1";
  const rememberedEmail = hosted && !changingEmail ? gate.account.email.trim().toLowerCase() : "";
  const hasRememberedAccount = hosted && Boolean(gate.account.email.trim());
  const accountEmail = rememberedEmail || emailParam;
  const step = hosted && !accountEmail ? "email" : "pin";
  const cookieStore = await cookies();
  const token = cookieStore.get(getInstancePinCookieName())?.value;
  const tenantToken = cookieStore.get(getTenantSessionCookieName())?.value;

  if ((await verifyInstancePinSessionToken(token)) && (await hasValidTenantSession(tenantToken))) {
    redirect(next);
  }

  const errorCode = getSingleValue(params.error);
  const errorMessage =
    errorCode === "invalid_pin"
      ? "Incorrect PIN. Try again."
      : errorCode === "invalid_email"
        ? "Enter the email for your account."
      : errorCode === "invalid_login"
        ? "That email and PIN do not match an account."
      : errorCode === "pin_disabled"
        ? "Your app PIN is not set up."
        : null;
  const initialClock = formatInitialClock(new Date());
  const activity = hasRememberedAccount ? await loadLockActivity() : [];

  return (
    <main className="instance-lock-shell">
      <div className="instance-lock-wallpaper" aria-hidden="true" />
      {hasRememberedAccount ? (
        <UnlockActivityHeader items={activity} />
      ) : null}
      <UnlockClock {...initialClock} />
      <section className="instance-lock-card" aria-label="Unlock Odogwu HQ">
        <BrandLogo className="instance-lock-logo" priority />
        <h1>Odogwu HQ</h1>
        <p className="instance-lock-copy">
          {step === "email"
            ? "Enter your email to continue"
            : "Enter PIN to unlock"}
        </p>
        <UnlockForm
          hosted={hosted}
          step={step}
          next={next}
          initialEmail={accountEmail}
          initialErrorMessage={errorMessage}
        />
        <p className="instance-lock-note">
          {hosted
            ? "Connected to this device"
            : "Protected on this device"}
        </p>
      </section>
    </main>
  );
}
