import { BrandLogo } from "@/components/brand-logo";
import { UnlockForm } from "@/components/unlock-form";
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
  const step = hosted && !emailParam ? "email" : "pin";
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

  return (
    <main className="instance-lock-shell">
      <section className="instance-lock-card">
        <p className="instance-lock-kicker">Locked</p>
        <BrandLogo className="instance-lock-logo" priority />
        <h1 className="panel-title">Unlock</h1>
        <p className="instance-lock-copy">
          {step === "email"
            ? "Enter your email to continue."
            : "Enter your PIN to open the app."}
        </p>
        <UnlockForm
          hosted={hosted}
          step={step}
          next={next}
          initialEmail={emailParam}
          initialErrorMessage={errorMessage}
        />
        <p className="instance-lock-note">
          {hosted
            ? "This keeps your account connected to this device."
            : "This PIN protects this app on this device."}
        </p>
      </section>
    </main>
  );
}
