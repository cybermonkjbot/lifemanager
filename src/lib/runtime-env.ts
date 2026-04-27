export function getConvexUrl() {
  return process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL || "";
}

export const DESKTOP_RUNTIME_COOKIE_NAME = "odogwu_desktop_runtime";
export const DESKTOP_RUNTIME_HEADER_NAME = "x-odogwu-desktop-runtime";

export function isElectronEnvironment() {
  return process.env.ODOGWU_DESKTOP === "1" || process.env.NEXT_PUBLIC_ODOGWU_DESKTOP === "1";
}

export function isValidDesktopRuntimeSecret(value: string | undefined | null) {
  const expected = (process.env.ODOGWU_DESKTOP_RUNTIME_SECRET || "").trim();
  return Boolean(expected && value && value === expected);
}
