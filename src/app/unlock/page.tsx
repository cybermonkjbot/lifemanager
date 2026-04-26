import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  getInstancePinCookieName,
  isInstancePinEnabled,
  normalizeInstanceNextPath,
  resolveInstanceGateState,
  verifyInstancePinSessionToken,
} from "@/lib/instance-pin";

type UnlockPageProps = {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

function getSingleValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
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
  const cookieStore = await cookies();
  const token = cookieStore.get(getInstancePinCookieName())?.value;

  if (await verifyInstancePinSessionToken(token)) {
    redirect(next);
  }

  const errorCode = getSingleValue(params.error);
  const errorMessage =
    errorCode === "invalid_pin"
      ? "Incorrect PIN. Try again."
      : errorCode === "pin_disabled"
        ? "Instance PIN is not configured."
        : null;

  return (
    <main className="instance-lock-shell">
      <section className="instance-lock-card">
        <p className="instance-lock-kicker">Locked</p>
        <h1 className="panel-title">Unlock Social Life Manager</h1>
        <p className="instance-lock-copy">
          Enter your PIN to open this dashboard on this device.
        </p>
        <form action="/api/auth/pin" method="post" className="instance-lock-form">
          <input type="hidden" name="next" value={next} />
          <label className="instance-lock-field">
            <span className="queue-meta">PIN</span>
            <input
              type="password"
              name="pin"
              inputMode="numeric"
              autoComplete="current-password"
              placeholder="Enter your PIN"
              autoFocus
              required
            />
          </label>
          {errorMessage ? <p className="instance-lock-error">{errorMessage}</p> : null}
          <button type="submit" className="btn btn-primary">
            Unlock
          </button>
        </form>
        <p className="instance-lock-note">This PIN protects this local app only.</p>
      </section>
    </main>
  );
}
