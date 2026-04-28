import { app, BrowserWindow, Menu, shell } from "electron";
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
const isDev = process.env.ODOGWU_DESKTOP_DEV === "1" || !app.isPackaged;
const desktopRuntimeCookieName = "odogwu_desktop_runtime";
const desktopRuntimeHeaderName = "x-odogwu-desktop-runtime";
const desktopRuntimeSecret = process.env.ODOGWU_DESKTOP_RUNTIME_SECRET || randomBytes(32).toString("base64url");
const children = new Set();

let mainWindow = null;

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

function createMenu(appUrl) {
  const template = [
    {
      label: "Odogwu HQ",
      submenu: [
        {
          label: "Open Local App",
          click: () => {
            if (mainWindow) {
              mainWindow.loadURL(appUrl);
              mainWindow.show();
            }
          },
        },
        {
          label: "Open Hosted Dashboard",
          click: () => {
            const hostedUrl = process.env.ODOGWU_HOSTED_DASHBOARD_URL;
            if (hostedUrl) {
              shell.openExternal(hostedUrl);
            }
          },
          enabled: Boolean(process.env.ODOGWU_HOSTED_DASHBOARD_URL),
        },
        { type: "separator" },
        { role: "quit" },
      ],
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
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(appUrl) {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 1040,
    minHeight: 720,
    title: "Odogwu HQ",
    icon: appIconPath,
    backgroundColor: "#0f1117",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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

app.setName("Odogwu HQ");
if (process.platform === "darwin" && app.dock) {
  app.dock.setIcon(appIconPath);
}

app.whenReady()
  .then(async () => {
    const port = Number(process.env.ODOGWU_DESKTOP_PORT || "") || (await findOpenPort());
    const appUrl = await startLocalAppRuntime(port);
    startWhatsappWorker(appUrl);
    createMenu(appUrl);
    await createWindow(appUrl);
  })
  .catch((error) => {
    console.error("[desktop] failed to launch:", error);
    app.quit();
  });

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && mainWindow) {
    mainWindow.show();
  }
});

app.on("before-quit", async (event) => {
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
