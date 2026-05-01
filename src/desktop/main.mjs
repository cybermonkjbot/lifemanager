import { app, BrowserWindow, clipboard, ipcMain, Menu, screen, shell } from "electron";
import { spawn } from "node:child_process";
import { createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { request } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..", "..");
const appIconPath = join(projectRoot, "public", "icons", "icon.png");
const preloadPath = join(__dirname, "preload.cjs");
const appName = "Odogwu HQ";
const appUserModelId = "com.odogwuhq.desktop";
const appProtocol = "odogwuhq";
const isDev = process.env.ODOGWU_DESKTOP_DEV === "1" || !app.isPackaged;
const desktopRuntimeCookieName = "odogwu_desktop_runtime";
const desktopRuntimeHeaderName = "x-odogwu-desktop-runtime";
const desktopRuntimeSecret = process.env.ODOGWU_DESKTOP_RUNTIME_SECRET || randomBytes(32).toString("base64url");
const children = new Set();

let mainWindow = null;
let currentAppUrl = "";
let pendingDeepLink = "";
let updateCheckInFlight = false;
let autoUpdater = null;
let installingUpdate = false;
let updateState = {
  status: "idle",
  version: "",
  error: "",
  progress: null,
};

function publishUpdateState(nextState) {
  updateState = {
    ...updateState,
    ...nextState,
  };
  mainWindow?.webContents.send("desktop-update-state", updateState);
}

function getNavigationTargets() {
  return [
    { label: "Home", path: "/", accelerator: "CommandOrControl+1" },
    { label: "Review Queue", path: "/review", accelerator: "CommandOrControl+2" },
    { label: "Conversations", path: "/conversations", accelerator: "CommandOrControl+3" },
    { label: "Status", path: "/status", accelerator: "CommandOrControl+4" },
    { label: "Media Library", path: "/media", accelerator: "CommandOrControl+5" },
    { label: "Memes", path: "/memes" },
    { label: "Catch Up", path: "/backlog" },
    { label: "Settings", path: "/settings", accelerator: "CommandOrControl+," },
  ];
}

function toAppUrl(appUrl, path) {
  const target = new URL(appUrl);
  const pathValue = String(path || "/");
  if (pathValue.startsWith("http://") || pathValue.startsWith("https://")) {
    return pathValue;
  }
  return new URL(pathValue.startsWith("/") ? pathValue : `/${pathValue}`, target.origin).toString();
}

async function showMainWindow(appUrl = currentAppUrl || "") {
  if (!appUrl) {
    return;
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    await createWindow(appUrl);
  }

  if (mainWindow?.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow?.show();
  mainWindow?.focus();
}

async function navigateToPath(appUrl, path) {
  await showMainWindow(appUrl);
  const url = toAppUrl(appUrl, path);
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.loadURL(url);
  }
}

function getDeepLinkFromArgv(argv = process.argv) {
  return argv.find((arg) => typeof arg === "string" && arg.startsWith(`${appProtocol}://`)) || "";
}

function getPathFromDeepLink(link) {
  try {
    const url = new URL(link);
    if (url.protocol !== `${appProtocol}:`) {
      return "";
    }

    const hostPath = url.hostname && url.hostname !== "open" ? `/${url.hostname}` : "";
    const path = `${hostPath}${url.pathname || ""}` || "/";
    return `${path}${url.search || ""}${url.hash || ""}`;
  } catch {
    return "";
  }
}

async function handleDeepLink(link) {
  const path = getPathFromDeepLink(link);
  if (!path) {
    return;
  }
  if (!currentAppUrl) {
    pendingDeepLink = link;
    return;
  }
  await navigateToPath(currentAppUrl, path);
}

function registerProtocolClient() {
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(appProtocol);
    return;
  }

  app.setAsDefaultProtocolClient(appProtocol, process.execPath, [process.argv[1]]);
}

function configurePlatformIdentity() {
  app.setName(appName);
  if (process.platform === "win32") {
    app.setAppUserModelId(appUserModelId);
  }
  registerProtocolClient();
}

function quoteWindowsArg(value) {
  const arg = String(value);
  if (arg.length > 0 && !/[\s"]/u.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function getCommand(command, args) {
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", [command, ...args].map(quoteWindowsArg).join(" ")],
    };
  }

  return { command, args };
}

function spawnManaged(label, command, args, env = {}, options = {}) {
  const resolved = getCommand(command, args);
  const child = spawn(resolved.command, resolved.args, {
    cwd: options.cwd || projectRoot,
    env: {
      ...process.env,
      ODOGWU_DESKTOP: "1",
      NODE_ENV: isDev ? "development" : "production",
      ...env,
    },
    stdio: isDev ? "inherit" : "pipe",
  });

  children.add(child);

  child.once("exit", (code, signal) => {
    children.delete(child);
    if (isDev) {
      console.log(`[desktop] ${label} exited`, { code, signal });
    }
  });

  child.once("error", (error) => {
    children.delete(child);
    console.error(`[desktop] failed to start ${label}:`, error);
  });

  return child;
}

async function findOpenPort() {
  return await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate a local port.")));
        return;
      }

      const port = address.port;
      server.close(() => resolvePromise(port));
    });
  });
}

async function waitForHttp(url, timeoutMs = 45_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const ok = await new Promise((resolvePromise) => {
      const req = request(
        url,
        {
          method: "GET",
          timeout: 1200,
          headers: {
            Cookie: `${desktopRuntimeCookieName}=${desktopRuntimeSecret}`,
            [desktopRuntimeHeaderName]: desktopRuntimeSecret,
          },
        },
        (res) => {
          res.resume();
          resolvePromise((res.statusCode || 500) < 500);
        },
      );
      req.once("timeout", () => {
        req.destroy();
        resolvePromise(false);
      });
      req.once("error", () => resolvePromise(false));
      req.end();
    });

    if (ok) {
      return true;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 350));
  }

  return false;
}

function getBunBin() {
  return process.env.BUN_BIN || "bun";
}

function getPackagedNodeBin() {
  if (process.platform === "darwin" && app.isPackaged) {
    const helperName = `${app.getName()} Helper`;
    const helperPath = join(dirname(process.execPath), "..", "Frameworks", `${helperName}.app`, "Contents", "MacOS", helperName);
    if (existsSync(helperPath)) {
      return helperPath;
    }
  }

  return process.env.ODOGWU_DESKTOP_NODE_BIN || process.execPath;
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

function getDesktopDataDir() {
  return ensureDir(process.env.SLM_DATA_DIR || join(app.getPath("userData"), "runtime"));
}

function normalizeDesktopAppUrl(appUrl, targetUrl) {
  try {
    const appOrigin = new URL(appUrl);
    const target = new URL(targetUrl);
    const loopback = target.hostname === "127.0.0.1" || target.hostname === "localhost";
    if (!loopback || target.port !== appOrigin.port) {
      return targetUrl;
    }
    target.protocol = appOrigin.protocol;
    target.hostname = appOrigin.hostname;
    return target.toString();
  } catch {
    return targetUrl;
  }
}

function desktopAppUrlPatterns(appUrl) {
  const url = new URL(appUrl);
  return [
    `${url.protocol}//127.0.0.1:${url.port}/*`,
    `${url.protocol}//localhost:${url.port}/*`,
  ];
}

function deriveLocalSecretKey(secret) {
  return createHash("sha256").update(`odogwu-local-secret:${secret}`).digest();
}

function decryptLocalSecret(encrypted, iv, tag, secret) {
  if (!encrypted || !iv || !tag || !secret) {
    return "";
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveLocalSecretKey(String(secret)), Buffer.from(String(iv), "base64url"));
    decipher.setAuthTag(Buffer.from(String(tag), "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(String(encrypted), "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}

function readDesktopServiceEnv(dataDir) {
  try {
    const raw = readFileSync(join(dataDir, "instance-config.json"), "utf8");
    const parsed = JSON.parse(raw);
    const preferences = parsed?.preferences || {};
    const account = parsed?.account || {};
    const pin = parsed?.pin || {};
    const connectorToken =
      String(account.connectorToken || "").trim() ||
      decryptLocalSecret(account.connectorTokenEncrypted, account.connectorTokenIv, account.connectorTokenTag, pin.cookieSecret);
    const selfHosted = preferences.selfHosted || {};
    if (preferences.serviceMode !== "self_hosted") {
      return {
        ODOGWU_SERVICE_MODE: "hosted",
        ...(account.tenantId ? { ODOGWU_TENANT_ID: String(account.tenantId) } : {}),
        ...(account.deviceId ? { ODOGWU_DEVICE_ID: String(account.deviceId) } : {}),
        ...(connectorToken ? { ODOGWU_CONNECTOR_TOKEN: connectorToken } : {}),
      };
    }

    const convexUrl = String(selfHosted.convexUrl || "").trim();
    const appBaseUrl = String(selfHosted.appBaseUrl || "").trim();
    const aiBaseUrl = String(selfHosted.aiBaseUrl || "").trim();
    const aiApiKey = String(selfHosted.aiApiKey || "").trim();
    const aiModel = String(selfHosted.aiModel || "").trim();

    return {
      ODOGWU_SERVICE_MODE: "self_hosted",
      ...(account.deviceId ? { ODOGWU_DEVICE_ID: String(account.deviceId) } : {}),
      ...(convexUrl
        ? {
            CONVEX_URL: process.env.CONVEX_URL || convexUrl,
            NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL || convexUrl,
          }
        : {}),
      ...(appBaseUrl ? { ODOGWU_SELF_HOSTED_APP_BASE_URL: appBaseUrl } : {}),
      ...(aiBaseUrl
        ? {
            SLM_SELF_HOSTED_AI_BASE_URL: aiBaseUrl,
            AZURE_AI_ENDPOINT: process.env.AZURE_AI_ENDPOINT || aiBaseUrl,
          }
        : {}),
      ...(aiApiKey
        ? {
            SLM_SELF_HOSTED_AI_API_KEY: aiApiKey,
            AZURE_AI_API_KEY: process.env.AZURE_AI_API_KEY || aiApiKey,
            OPENAI_API_KEY: process.env.OPENAI_API_KEY || aiApiKey,
          }
        : {}),
      ...(aiModel
        ? {
            SLM_SELF_HOSTED_AI_MODEL: aiModel,
            AZURE_AI_MODEL: process.env.AZURE_AI_MODEL || aiModel,
          }
        : {}),
    };
  } catch {
    return {
      ODOGWU_SERVICE_MODE: "hosted",
    };
  }
}

function getDesktopProcessEnv(extra = {}) {
  const dataDir = getDesktopDataDir();
  const whatsappConnectorEntry = join(projectRoot, "dist", "connector", "index.mjs");
  const instagramConnectorEntry = join(projectRoot, "dist", "connector", "instagram.mjs");
  return {
    ODOGWU_DESKTOP: "1",
    NEXT_PUBLIC_ODOGWU_DESKTOP: "1",
    ODOGWU_DESKTOP_RUNTIME_SECRET: desktopRuntimeSecret,
    ODOGWU_DESKTOP_NODE_BIN: getPackagedNodeBin(),
    ODOGWU_CONNECTOR_WHATSAPP_ENTRY: whatsappConnectorEntry,
    ODOGWU_CONNECTOR_INSTAGRAM_ENTRY: instagramConnectorEntry,
    SLM_DATA_DIR: dataDir,
    SLM_WORKER_ID: process.env.SLM_WORKER_ID || "desktop-whatsapp",
    WHATSAPP_AUTH_PATH: ensureDir(process.env.WHATSAPP_AUTH_PATH || join(dataDir, "whatsapp-auth")),
    INSTAGRAM_AUTH_PATH: ensureDir(process.env.INSTAGRAM_AUTH_PATH || join(dataDir, "instagram-auth")),
    SLM_EMBEDDINGS_CACHE_DIR: ensureDir(process.env.SLM_EMBEDDINGS_CACHE_DIR || join(dataDir, "transformers-cache")),
    ...readDesktopServiceEnv(dataDir),
    ...extra,
  };
}

async function startLocalAppRuntime(port) {
  const appUrl = `http://127.0.0.1:${port}`;
  const runtimeEnv = getDesktopProcessEnv({
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    ODOGWU_DESKTOP_APP_URL: appUrl,
  });

  let child;
  if (isDev) {
    child = spawnManaged(
      "local app runtime",
      getBunBin(),
      ["x", "next", "dev", "-H", "127.0.0.1", "-p", String(port)],
      runtimeEnv,
    );
  } else {
    const standaloneServerPath = join(projectRoot, ".next", "standalone", "server.js");
    if (!existsSync(standaloneServerPath)) {
      throw new Error(`Missing packaged Next standalone server at ${standaloneServerPath}.`);
    }
    child = spawnManaged(
      "local app runtime",
      getPackagedNodeBin(),
      [standaloneServerPath],
      {
        ...runtimeEnv,
        ELECTRON_RUN_AS_NODE: "1",
      },
      { cwd: join(projectRoot, ".next", "standalone") },
    );
  }

  if (child.pid) {
    writeFileSync(join(getDesktopDataDir(), "app.pid"), `${child.pid}\n`, "utf8");
  }

  const ready = await waitForHttp(appUrl);
  if (!ready) {
    throw new Error(`Local app runtime did not become ready at ${appUrl}.`);
  }

  return appUrl;
}

function startWhatsappWorker(appUrl) {
  if (process.env.ODOGWU_DESKTOP_START_WORKER === "0") {
    return null;
  }

  const env = getDesktopProcessEnv({
    ODOGWU_DESKTOP_APP_URL: appUrl,
    SLM_APP_START_CMD: "",
  });

  if (!isDev && existsSync(env.ODOGWU_CONNECTOR_WHATSAPP_ENTRY)) {
    return spawnManaged(
      "WhatsApp connector",
      getPackagedNodeBin(),
      [env.ODOGWU_CONNECTOR_WHATSAPP_ENTRY],
      {
        ...env,
        ELECTRON_RUN_AS_NODE: "1",
      },
    );
  }

  return spawnManaged("WhatsApp connector", getBunBin(), ["run", "worker"], env);
}

function createNavigationMenuItems(appUrl) {
  return getNavigationTargets().map((target) => ({
    label: target.label,
    accelerator: target.accelerator,
    click: () => {
      void navigateToPath(appUrl, target.path);
    },
  }));
}

function createMenu(appUrl) {
  const navigationItems = createNavigationMenuItems(appUrl);
  const hostedUrl = process.env.ODOGWU_HOSTED_DASHBOARD_URL;
  const template = [
    ...(process.platform === "darwin"
      ? [
          {
            label: appName,
            submenu: [
              { role: "about" },
              { type: "separator" },
              {
                label: "Settings...",
                accelerator: "Command+,",
                click: () => {
                  void navigateToPath(appUrl, "/settings");
                },
              },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Home",
          accelerator: "CommandOrControl+O",
          click: () => {
            void navigateToPath(appUrl, "/");
          },
        },
        {
          label: "Open Hosted Dashboard",
          click: () => {
            if (hostedUrl) {
              shell.openExternal(hostedUrl);
            }
          },
          enabled: Boolean(hostedUrl),
        },
        { type: "separator" },
        ...(process.platform === "darwin" ? [{ role: "close" }] : [{ role: "quit" }]),
      ],
    },
    {
      label: "Navigate",
      submenu: navigationItems,
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { type: "separator" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools", visible: isDev },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu:
        process.platform === "darwin"
          ? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
          : [{ role: "minimize" }, { role: "close" }],
    },
    {
      role: "help",
      submenu: [
        {
          label: "Open Project on GitHub",
          click: () => {
            shell.openExternal("https://github.com/cybermonkjbot/lifemanager");
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function configureDockMenu(appUrl) {
  if (process.platform !== "darwin" || !app.dock) {
    return;
  }

  app.dock.setMenu(
    Menu.buildFromTemplate([
      {
        label: "Open Review Queue",
        click: () => {
          void navigateToPath(appUrl, "/review");
        },
      },
      {
        label: "Open Conversations",
        click: () => {
          void navigateToPath(appUrl, "/conversations");
        },
      },
      {
        label: "Open Settings",
        click: () => {
          void navigateToPath(appUrl, "/settings");
        },
      },
    ]),
  );
}

function configureWindowsJumpList() {
  if (process.platform !== "win32") {
    return;
  }

  app.setJumpList([
    {
      type: "tasks",
      items: [
        {
          type: "task",
          title: "Open Review Queue",
          description: "Review pending replies and follow-ups",
          program: process.execPath,
          args: `${appProtocol}://review`,
          iconPath: appIconPath,
          iconIndex: 0,
        },
        {
          type: "task",
          title: "Open Conversations",
          description: "Go straight to conversations",
          program: process.execPath,
          args: `${appProtocol}://conversations`,
          iconPath: appIconPath,
          iconIndex: 0,
        },
        {
          type: "task",
          title: "Open Settings",
          description: "Adjust desktop and automation settings",
          program: process.execPath,
          args: `${appProtocol}://settings`,
          iconPath: appIconPath,
          iconIndex: 0,
        },
      ],
    },
    { type: "recent" },
  ]);
}

function getWindowStatePath() {
  return join(app.getPath("userData"), "window-state.json");
}

function readWindowState() {
  try {
    const parsed = JSON.parse(readFileSync(getWindowStatePath(), "utf8"));
    if (!Number.isFinite(parsed.width) || !Number.isFinite(parsed.height)) {
      return {};
    }

    const bounds = {
      width: Math.max(1040, Math.round(parsed.width)),
      height: Math.max(720, Math.round(parsed.height)),
      ...(Number.isFinite(parsed.x) ? { x: Math.round(parsed.x) } : {}),
      ...(Number.isFinite(parsed.y) ? { y: Math.round(parsed.y) } : {}),
    };
    if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) {
      return {
        ...bounds,
        isMaximized: Boolean(parsed.isMaximized),
        isFullScreen: Boolean(parsed.isFullScreen),
      };
    }

    const display = screen.getDisplayMatching(bounds);
    const visibleEnough =
      bounds.x < display.workArea.x + display.workArea.width - 80 &&
      bounds.y < display.workArea.y + display.workArea.height - 80 &&
      bounds.x + bounds.width > display.workArea.x + 80 &&
      bounds.y + bounds.height > display.workArea.y + 80;

    return visibleEnough
      ? {
          ...bounds,
          isMaximized: Boolean(parsed.isMaximized),
          isFullScreen: Boolean(parsed.isFullScreen),
        }
      : {};
  } catch {
    return {};
  }
}

function writeWindowState(window) {
  if (!window || window.isDestroyed()) {
    return;
  }

  const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds();
  writeFileSync(
    getWindowStatePath(),
    JSON.stringify(
      {
        ...bounds,
        isMaximized: window.isMaximized(),
        isFullScreen: window.isFullScreen(),
      },
      null,
      2,
    ),
    "utf8",
  );
}

function normalizeContextMenuTemplate(template) {
  return template.filter((item, index, items) => {
    if (item.type !== "separator") {
      return true;
    }
    return index > 0 && index < items.length - 1 && items[index - 1]?.type !== "separator";
  });
}

function installContextMenu(window) {
  window.webContents.on("context-menu", (_event, params) => {
    const template = [];

    if (params.linkURL) {
      template.push(
        {
          label: "Open Link in Browser",
          click: () => {
            shell.openExternal(params.linkURL);
          },
        },
        {
          label: "Copy Link",
          click: () => {
            clipboard.writeText(params.linkURL);
          },
        },
        { type: "separator" },
      );
    }

    if (params.mediaType === "image") {
      template.push(
        {
          label: "Copy Image",
          click: () => {
            window.webContents.copyImageAt(params.x, params.y);
          },
        },
        {
          label: "Copy Image Address",
          enabled: Boolean(params.srcURL),
          click: () => {
            clipboard.writeText(params.srcURL);
          },
        },
        { type: "separator" },
      );
    }

    if (params.isEditable) {
      for (const suggestion of params.dictionarySuggestions?.slice(0, 5) || []) {
        template.push({
          label: suggestion,
          click: () => {
            window.webContents.replaceMisspelling(suggestion);
          },
        });
      }
      if (params.misspelledWord) {
        template.push({
          label: `Add "${params.misspelledWord}" to Dictionary`,
          click: () => {
            window.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord);
          },
        });
      }
      if (params.misspelledWord || params.dictionarySuggestions?.length) {
        template.push({ type: "separator" });
      }
      template.push(
        { role: "undo", enabled: params.editFlags.canUndo },
        { role: "redo", enabled: params.editFlags.canRedo },
        { type: "separator" },
        { role: "cut", enabled: params.editFlags.canCut },
        { role: "copy", enabled: params.editFlags.canCopy },
        { role: "paste", enabled: params.editFlags.canPaste },
        { role: "pasteAndMatchStyle", enabled: params.editFlags.canPaste },
        { role: "delete", enabled: params.editFlags.canDelete },
        { type: "separator" },
        { role: "selectAll", enabled: params.editFlags.canSelectAll },
      );
    } else if (params.selectionText) {
      template.push({ role: "copy" }, { role: "selectAll" });
    }

    if (isDev) {
      if (template.length > 0) {
        template.push({ type: "separator" });
      }
      template.push({
        label: "Inspect Element",
        click: () => {
          window.webContents.inspectElement(params.x, params.y);
        },
      });
    }

    const normalizedTemplate = normalizeContextMenuTemplate(template);
    if (normalizedTemplate.length > 0) {
      Menu.buildFromTemplate(normalizedTemplate).popup({ window });
    }
  });
}

async function createWindow(appUrl) {
  const windowState = readWindowState();
  mainWindow = new BrowserWindow({
    width: windowState.width || 1320,
    height: windowState.height || 900,
    ...(Number.isFinite(windowState.x) ? { x: windowState.x } : {}),
    ...(Number.isFinite(windowState.y) ? { y: windowState.y } : {}),
    minWidth: 1040,
    minHeight: 720,
    title: appName,
    icon: appIconPath,
    backgroundColor: "#0f1117",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: true,
    },
  });

  installContextMenu(mainWindow);

  if (windowState.isMaximized) {
    mainWindow.maximize();
  } else if (windowState.isFullScreen) {
    mainWindow.setFullScreen(true);
  }

  let windowStateSaveTimer = null;
  const scheduleWindowStateSave = () => {
    if (windowStateSaveTimer) {
      clearTimeout(windowStateSaveTimer);
    }
    windowStateSaveTimer = setTimeout(() => writeWindowState(mainWindow), 350);
  };

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.on("resize", scheduleWindowStateSave);
  mainWindow.on("move", scheduleWindowStateSave);
  mainWindow.on("close", () => {
    if (windowStateSaveTimer) {
      clearTimeout(windowStateSaveTimer);
    }
    writeWindowState(mainWindow);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.webContents.session.cookies.set({
    url: appUrl,
    name: desktopRuntimeCookieName,
    value: desktopRuntimeSecret,
    httpOnly: true,
    path: "/",
    sameSite: "strict",
    secure: false,
  });
  mainWindow.webContents.session.webRequest.onBeforeRequest(
    { urls: desktopAppUrlPatterns(appUrl) },
    (details, callback) => {
      const normalizedUrl = normalizeDesktopAppUrl(appUrl, details.url);
      callback(normalizedUrl === details.url ? {} : { redirectURL: normalizedUrl });
    },
  );
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: desktopAppUrlPatterns(appUrl) },
    (details, callback) => {
      callback({
        requestHeaders: {
          ...details.requestHeaders,
          [desktopRuntimeHeaderName]: desktopRuntimeSecret,
        },
      });
    },
  );

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if ((target.hostname === "127.0.0.1" || target.hostname === "localhost") && target.port === new URL(appUrl).port) {
        if (target.hostname === "localhost") {
          mainWindow?.loadURL(normalizeDesktopAppUrl(appUrl, url));
          return { action: "deny" };
        }
        return { action: "allow" };
      }
    } catch {
      return { action: "deny" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(appUrl);
}

async function setupAutoUpdates() {
  if (isDev || process.env.ODOGWU_DESKTOP_AUTO_UPDATE === "0") {
    return;
  }

  const updaterModule = await import("electron-updater");
  autoUpdater = updaterModule.default?.autoUpdater || updaterModule.autoUpdater;
  if (!autoUpdater) {
    console.warn("[desktop] auto updater is unavailable.");
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => {
    publishUpdateState({ status: "checking", error: "", progress: null });
  });
  autoUpdater.on("update-available", (info) => {
    publishUpdateState({ status: "downloading", version: info?.version || "", error: "", progress: 0 });
  });
  autoUpdater.on("update-not-available", () => {
    publishUpdateState({ status: "idle", error: "", progress: null });
  });
  autoUpdater.on("error", (error) => {
    publishUpdateState({ status: "error", error: error?.message || "Update check failed.", progress: null });
    console.error("[desktop] update check failed:", error);
  });
  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0)));
    publishUpdateState({ status: "downloading", progress: percent, error: "" });
  });
  autoUpdater.on("update-downloaded", (info) => {
    publishUpdateState({ status: "ready", version: info?.version || updateState.version || "", error: "", progress: 100 });
    console.log("[desktop] update downloaded; it will install when the app quits.");
  });

  const checkForUpdates = async () => {
    if (updateCheckInFlight) {
      return;
    }
    updateCheckInFlight = true;
    try {
      await autoUpdater.checkForUpdatesAndNotify();
    } finally {
      updateCheckInFlight = false;
    }
  };

  setTimeout(() => {
    void checkForUpdates();
  }, 10_000);
  setInterval(() => {
    void checkForUpdates();
  }, 4 * 60 * 60 * 1000);
}

ipcMain.handle("desktop-update-get-state", () => updateState);

ipcMain.handle("desktop-update-restart", async () => {
  if (!autoUpdater || updateState.status !== "ready") {
    return { ok: false, error: "No downloaded update is ready to install." };
  }

  try {
    installingUpdate = true;
    publishUpdateState({ status: "restarting", error: "", progress: 100 });
    await stopChildren();
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  } catch (error) {
    installingUpdate = false;
    const message = error instanceof Error ? error.message : "Could not restart for the update.";
    publishUpdateState({ status: "ready", error: message });
    return { ok: false, error: message };
  }
});

ipcMain.handle("desktop-native-set-badge-count", (_event, value) => {
  const count = Math.max(0, Math.trunc(Number(value) || 0));
  app.setBadgeCount(count);
  if (process.platform === "darwin" && app.dock) {
    app.dock.setBadge(count > 0 ? String(count) : "");
  }
  return { ok: true };
});

ipcMain.handle("desktop-native-set-progress", (_event, value) => {
  const progress = Number(value);
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: "Main window is not available." };
  }
  mainWindow.setProgressBar(Number.isFinite(progress) ? Math.max(-1, Math.min(1, progress)) : -1);
  return { ok: true };
});

ipcMain.handle("desktop-native-open-path", async (_event, path) => {
  await navigateToPath(currentAppUrl, String(path || "/"));
  return { ok: true };
});

async function stopChildren() {
  const active = [...children];
  for (const child of active) {
    if (child.killed) {
      continue;
    }
    child.kill("SIGTERM");
  }

  await new Promise((resolvePromise) => setTimeout(resolvePromise, 900));

  for (const child of [...children]) {
    if (!child.killed) {
      child.kill("SIGKILL");
    }
  }
}

configurePlatformIdentity();

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const deepLink = getDeepLinkFromArgv(argv);
    if (deepLink) {
      void handleDeepLink(deepLink);
      return;
    }
    void showMainWindow();
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    void handleDeepLink(url);
  });

  app.whenReady()
    .then(async () => {
      if (process.platform === "darwin" && app.dock) {
        app.dock.setIcon(appIconPath);
      }

      const port = Number(process.env.ODOGWU_DESKTOP_PORT || "") || (await findOpenPort());
      const appUrl = await startLocalAppRuntime(port);
      currentAppUrl = appUrl;
      startWhatsappWorker(appUrl);
      createMenu(appUrl);
      configureDockMenu(appUrl);
      configureWindowsJumpList();
      await createWindow(appUrl);
      await setupAutoUpdates();

      const startupDeepLink = pendingDeepLink || getDeepLinkFromArgv(process.argv);
      pendingDeepLink = "";
      if (startupDeepLink) {
        await handleDeepLink(startupDeepLink);
      }
    })
    .catch((error) => {
      console.error("[desktop] failed to launch:", error);
      app.quit();
    });
}

app.on("activate", () => {
  void showMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async (event) => {
  if (installingUpdate) {
    return;
  }
  if (children.size === 0) {
    return;
  }
  event.preventDefault();
  await stopChildren();
  app.exit(0);
});

process.on("SIGINT", () => {
  void stopChildren().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void stopChildren().finally(() => process.exit(0));
});
