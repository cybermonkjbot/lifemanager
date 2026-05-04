export {};

type DesktopPermissionKind = "microphone" | "full-disk-access";

type DesktopPermissionState = {
  kind: DesktopPermissionKind | string;
  status: "not-determined" | "granted" | "denied" | "restricted" | "unknown";
  granted: boolean;
  canAsk: boolean;
  requiresManualGrant: boolean;
  settingsOpened?: boolean;
  databasePath?: string;
  message: string;
};

type DesktopPermissionOpenResult = {
  ok: boolean;
  error?: string;
  permission?: DesktopPermissionState;
};

type DesktopNativeApi = {
  setBadgeCount: (count: number) => Promise<{ ok: boolean; error?: string }>;
  setProgress: (progress: number) => Promise<{ ok: boolean; error?: string }>;
  openPath: (path: string) => Promise<{ ok: boolean; error?: string }>;
  getPermission: (kind: DesktopPermissionKind) => Promise<DesktopPermissionState>;
  requestPermission: (kind: DesktopPermissionKind) => Promise<DesktopPermissionState>;
  openPermissionSettings: (kind: DesktopPermissionKind) => Promise<DesktopPermissionOpenResult>;
};

declare global {
  interface Window {
    odogwuDesktopNative?: DesktopNativeApi;
  }
}
