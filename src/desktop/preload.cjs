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
