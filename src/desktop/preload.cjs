// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("odogwuDesktopUpdates", {
  getState: () => ipcRenderer.invoke("desktop-update-get-state"),
  restartAndInstall: () => ipcRenderer.invoke("desktop-update-restart"),
  onStateChange: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }

    const listener = (_event, state) => {
      callback(state);
    };

    ipcRenderer.on("desktop-update-state", listener);
    return () => {
      ipcRenderer.removeListener("desktop-update-state", listener);
    };
  },
});

contextBridge.exposeInMainWorld("odogwuDesktopNative", {
  setBadgeCount: (count) => ipcRenderer.invoke("desktop-native-set-badge-count", count),
  setProgress: (progress) => ipcRenderer.invoke("desktop-native-set-progress", progress),
  openPath: (path) => ipcRenderer.invoke("desktop-native-open-path", path),
  getPermission: (kind) => ipcRenderer.invoke("desktop-permission-get", kind),
  requestPermission: (kind) => ipcRenderer.invoke("desktop-permission-request", kind),
  openPermissionSettings: (kind) => ipcRenderer.invoke("desktop-permission-open-settings", kind),
});
