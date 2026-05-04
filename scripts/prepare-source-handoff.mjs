#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import { access, cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_OUT_DIR = "dist/source-handoff";

const ROOT_EXCLUDES = new Set([
  ".agents",
  ".claude",
  ".codex",
  ".git",
  ".ig_auth",
  ".next",
  ".playwright-mcp",
  ".slm",
  ".tmp",
  ".trae",
  ".wa_auth",
  ".windsurf",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

const FILE_EXCLUDES = new Set([
  ".DS_Store",
  ".env.local",
  "next-env.d.ts",
  "tsconfig.tsbuildinfo",
]);

const PRIVATE_ADMIN_PATHS = [
  "scripts/prepare-source-handoff.mjs",
  "src/app/admin",
  "src/app/api/admin",
  "src/app/api/billing",
  "src/components/admin-secrets-dashboard.tsx",
  "src/components/admin-tenants-dashboard.tsx",
  "convex/adminSecrets.ts",
  "convex/adminUsers.ts",
  "convex/billing.ts",
  "convex/billingActions.ts",
];

const SENSITIVE_SIGNATURES = [
  "adminSecrets:",
  "adminUsers:",
  "tenantAccounts:admin",
  "requireAdmin(adminSecret",
  "managedSecrets:",
  "ODOGWU_CONVEX_ADMIN_SECRET",
];

function parseArgs(argv) {
  const args = {
    force: false,
    help: false,
    outDir: DEFAULT_OUT_DIR,
    verifyOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--force" || token === "-f") {
      args.force = true;
      continue;
    }
    if (token === "--out") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --out");
      }
      args.outDir = value;
      index += 1;
      continue;
    }
    if (token === "--verify-only") {
      args.verifyOnly = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function printHelp() {
  console.log(`
Prepare an authorized source handoff with private admin modules removed.

Usage:
  node scripts/prepare-source-handoff.mjs [--out dist/source-handoff] [--force]
  node scripts/prepare-source-handoff.mjs --verify-only [--out dist/source-handoff]

Options:
  --out <path>     Export directory. Defaults to dist/source-handoff.
  --force, -f      Remove an existing export directory before writing.
  --verify-only    Verify an existing export without copying files.
  --help, -h       Show this help.
`);
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function isNestedPath(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function exists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function assertSafeOutDir(outDir) {
  const resolved = path.resolve(PROJECT_ROOT, outDir);
  if (resolved === PROJECT_ROOT || !isNestedPath(PROJECT_ROOT, resolved)) {
    throw new Error(`Refusing to write outside the project root: ${outDir}`);
  }
  return resolved;
}

function shouldCopy(src) {
  const rel = toPosix(path.relative(PROJECT_ROOT, src));
  if (!rel) {
    return true;
  }
  const [rootName] = rel.split("/");
  const baseName = path.basename(src);
  return !ROOT_EXCLUDES.has(rootName) && !FILE_EXCLUDES.has(baseName);
}

async function copyProject(outDir, force) {
  if (await exists(outDir)) {
    if (!force) {
      throw new Error(`Export directory already exists: ${path.relative(PROJECT_ROOT, outDir)}. Re-run with --force.`);
    }
    await rm(outDir, { force: true, recursive: true });
  }

  const stagingParent = await mkdtemp(path.join(tmpdir(), "odogwuhq-oss-"));
  const stagingDir = path.join(stagingParent, "source-handoff");
  await cp(PROJECT_ROOT, stagingDir, {
    dereference: false,
    errorOnExist: false,
    filter: shouldCopy,
    force: true,
    recursive: true,
    verbatimSymlinks: true,
  });
  await mkdir(path.dirname(outDir), { recursive: true });
  await rename(stagingDir, outDir);
  await rm(stagingParent, { force: true, recursive: true });
}

async function removePrivatePaths(outDir) {
  await Promise.all(
    PRIVATE_ADMIN_PATHS.map((relPath) => rm(path.join(outDir, relPath), { force: true, recursive: true })),
  );
}

async function readText(outDir, relPath) {
  return await readFile(path.join(outDir, relPath), "utf8");
}

async function writeText(outDir, relPath, content) {
  const target = path.join(outDir, relPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

function findMatchingClose(text, startIndex) {
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "/" && next === "/") {
      const newline = text.indexOf("\n", index + 2);
      index = newline === -1 ? text.length : newline;
      continue;
    }

    if (char === "/" && next === "*") {
      const close = text.indexOf("*/", index + 2);
      index = close === -1 ? text.length : close + 1;
      continue;
    }

    if (char === "{" || char === "(" || char === "[") {
      depth += 1;
      continue;
    }
    if (char === "}" || char === ")" || char === "]") {
      depth -= 1;
      if (depth === 0 && text.slice(index, index + 3) === "});") {
        return index + 3;
      }
    }
  }

  throw new Error("Could not find the end of a Convex export while redacting admin code.");
}

function removeConvexExports(text, exportNames) {
  let next = text;
  for (const name of exportNames) {
    const pattern = new RegExp(`\\n?export const ${name} = (query|mutation|action|internalQuery|internalMutation|internalAction)\\(\\{`);
    const match = next.match(pattern);
    if (!match || match.index === undefined) {
      continue;
    }
    const start = match.index;
    const openBrace = next.indexOf("{", start);
    const end = findMatchingClose(next, openBrace);
    next = `${next.slice(0, start)}\n${next.slice(end)}`;
  }
  return next.replace(/\n{3,}/g, "\n\n");
}

function removeFunctionBlock(text, name) {
  const pattern = new RegExp(`\\n?function ${name}\\([^)]*\\) \\{`);
  const match = text.match(pattern);
  if (!match || match.index === undefined) {
    return text;
  }
  const start = match.index;
  let depth = 0;
  for (let index = text.indexOf("{", start); index < text.length; index += 1) {
    if (text[index] === "{") {
      depth += 1;
    }
    if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return `${text.slice(0, start)}\n${text.slice(index + 1)}`.replace(/\n{3,}/g, "\n\n");
      }
    }
  }
  throw new Error(`Could not redact function ${name}.`);
}

function removeObjectProperty(text, propertyName) {
  const pattern = new RegExp(`\\n\\s{2}${propertyName}: defineTable\\(\\{`);
  const match = text.match(pattern);
  if (!match || match.index === undefined) {
    return text;
  }

  const start = match.index;
  const nextProperty = text.slice(start + 1).search(/\n\s{2}[A-Za-z0-9_]+: defineTable\(\{/);
  const end = nextProperty === -1 ? text.indexOf("\n});", start) : start + 1 + nextProperty;
  if (end === -1) {
    throw new Error(`Could not redact schema property ${propertyName}.`);
  }
  return `${text.slice(0, start)}${text.slice(end)}`.replace(/\n{3,}/g, "\n\n");
}

async function redactTenantAccounts(outDir) {
  const relPath = "convex/tenantAccounts.ts";
  let text = await readText(outDir, relPath);
  text = removeConvexExports(text, [
    "adminList",
    "adminGet",
    "adminUpdateSubscription",
    "adminUpsertUser",
    "adminRemoveUser",
    "adminSeedOwnerAndBackfill",
  ]);
  text = removeFunctionBlock(text, "readAdminSecret");
  text = removeFunctionBlock(text, "requireAdmin");
  await writeText(outDir, relPath, text);
}

async function redactSchema(outDir) {
  const relPath = "convex/schema.ts";
  let text = await readText(outDir, relPath);
  text = removeObjectProperty(text, "managedSecrets");
  text = removeObjectProperty(text, "adminUsers");
  await writeText(outDir, relPath, text);
}

async function redactConvexRefs(outDir) {
  const relPath = "src/lib/convex-refs.ts";
  const text = await readText(outDir, relPath);
  const redacted = text
    .split("\n")
    .filter((line) => !/(adminSecrets|adminUsers|tenantAccountsAdmin|billingAdmin|billingGetTenantBillingSummary)/.test(line))
    .join("\n");
  await writeText(outDir, relPath, redacted);

  for (const generatedPath of ["convex/_generated/api.d.ts", "convex/_generated/api.js"]) {
    const target = path.join(outDir, generatedPath);
    if (await exists(target)) {
      const generated = await readText(outDir, generatedPath);
      await writeText(
        outDir,
        generatedPath,
        generated
          .split("\n")
          .filter((line) => !/(adminSecrets|adminUsers|billing|billingActions|tenantAccounts:admin|adminList|adminGet|adminUpdateSubscription|adminUpsertUser|adminRemoveUser|adminSeedOwnerAndBackfill)/.test(line))
          .join("\n"),
      );
    }
  }
}

async function redactConvexCrons(outDir) {
  const relPath = "convex/crons.ts";
  const target = path.join(outDir, relPath);
  if (!(await exists(target))) {
    return;
  }
  const text = await readText(outDir, relPath);
  const withoutWeeklyTenantReports = text.replace(
    /crons\.cron\("weekly-tenant-owner-reports"[\s\S]*?\n\}\);\n/g,
    "",
  );
  await writeText(
    outDir,
    relPath,
    withoutWeeklyTenantReports
      .split("\n")
      .filter((line) => !/billing|refWeeklyTenantReports/i.test(line))
      .join("\n"),
  );
}

async function writeCompatibilityStubs(outDir) {
  await writeText(
    outDir,
    "src/lib/admin-auth.ts",
    `import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { requireInstancePageAccess } from "./instance-guard";

export type AdminSession = {
  email: string;
  expiresAt: number;
};

export function getAdminCookieName() {
  return "__reserved_console_session";
}

export function getAdminCookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 };
}

export function clearAdminCookieOptions() {
  return getAdminCookieOptions();
}

export function normalizeAdminNextPath(value: string | undefined | null) {
  return value?.startsWith("/") ? value : "/";
}

export function buildAdminSessionToken(email?: string, now?: number) {
  void email;
  void now;
  throw new Error("The hosted console is not included in this source handoff.");
}

export function readAdminSessionToken(token?: string | null, now?: number): AdminSession | null {
  void token;
  void now;
  return null;
}

export function verifyAdminSessionToken(token?: string | null, now?: number) {
  void token;
  void now;
  return false;
}

export function verifyAdminRequest(request?: NextRequest, options?: { requireSameOrigin?: boolean }) {
  void request;
  void options;
  return false;
}

export function getAdminSessionFromRequest(request: NextRequest, options?: { requireSameOrigin?: boolean }) {
  void request;
  void options;
  return null;
}

export async function requireAdminPageAccess(nextPath = "/") {
  await requireInstancePageAccess();
  if (nextPath.startsWith("/admin")) {
    redirect("/");
  }
}
`,
  );

  await writeText(
    outDir,
    "src/lib/admin-masquerade.ts",
    `import type { NextRequest } from "next/server";

export type AdminMasqueradeSession = {
  adminEmail: string;
  tenantId: string;
  tenantEmail: string;
  expiresAt: number;
};

export function getAdminMasqueradeCookieName() {
  return "__reserved_console_context";
}

export function getAdminMasqueradeCookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 };
}

export function clearAdminMasqueradeCookieOptions() {
  return getAdminMasqueradeCookieOptions();
}

export function buildAdminMasqueradeToken(args?: {
  adminEmail: string;
  tenantId: string;
  tenantEmail: string;
  now?: number;
}) {
  void args;
  throw new Error("The hosted console is not included in this source handoff.");
}

export function readAdminMasqueradeToken(token?: string | null, now?: number): AdminMasqueradeSession | null {
  void token;
  void now;
  return null;
}

export function getAdminMasqueradeFromRequest(request: NextRequest) {
  void request;
  return null;
}
`,
  );

  await writeText(
    outDir,
    "src/components/admin-masquerade-banner.tsx",
    `import type { AdminMasqueradeSession } from "@/lib/admin-masquerade";

export function AdminMasqueradeBanner(props: { session?: AdminMasqueradeSession | null }) {
  void props;
  return null;
}
`,
  );

  await writeText(
    outDir,
    "src/lib/admin-users.ts",
    `export type PublicAdminUser = {
  email: string;
  canMasqueradeTenants: boolean;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
};

export function normalizeAdminEmail(value: string | undefined | null) {
  return value?.trim().toLowerCase() || "";
}

export function isValidAdminEmail(value: string) {
  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value.trim().toLowerCase());
}

export async function listAdminUsers(): Promise<PublicAdminUser[]> {
  return [];
}

export async function verifyAdminCredentials() {
  return null;
}

export async function upsertAdminUser() {
  throw new Error("The hosted console is not included in this source handoff.");
}

export async function removeAdminUser() {
  throw new Error("The hosted console is not included in this source handoff.");
}

export async function getAdminCapabilities() {
  return { canMasqueradeTenants: false };
}

export async function adminCanMasqueradeTenants() {
  return false;
}
`,
  );

  await writeText(
    outDir,
    "src/lib/managed-secrets-server.ts",
    `export type ManagedAiRuntimeOverrides = Record<string, string>;

export async function getManagedAiRuntimeOverrides(): Promise<ManagedAiRuntimeOverrides> {
  return {};
}
`,
  );

  await writeText(
    outDir,
    "src/lib/managed-secret-crypto.ts",
    `export function getAdminSecret() {
  return undefined;
}

export function getConvexAdminSecret() {
  return undefined;
}

export function requireAdminSecret() {
  throw new Error("The hosted console is not included in this source handoff.");
}

export function secretMatches() {
  return false;
}
`,
  );
}

async function redactInstanceGuard(outDir) {
  await writeText(
    outDir,
    "src/lib/instance-guard.ts",
    `import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import {
  getInstancePinCookieName,
  isInstancePinEnabled,
  normalizeInstanceNextPath,
  resolveInstanceGateState,
  verifyInstancePinSessionToken,
} from "./instance-pin";
import {
  getTenantSessionCookieName,
  hasValidTenantSession,
} from "./tenant-session";

type UnauthorizedResponseKind = "json" | "redirect";

function readCookieValue(rawCookieHeader: string | null, cookieName: string) {
  if (!rawCookieHeader) {
    return undefined;
  }

  for (const part of rawCookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === cookieName) {
      return valueParts.join("=");
    }
  }

  return undefined;
}

function buildUnlockUrl(request: Request) {
  const requestUrl = new URL(request.url);
  const nextPath = normalizeInstanceNextPath(\`\${requestUrl.pathname}\${requestUrl.search}\`);
  const unlockUrl = new URL("/unlock", request.url);
  if (nextPath !== "/") {
    unlockUrl.searchParams.set("next", nextPath);
  }
  return unlockUrl;
}

async function hasValidInstanceSession(token: string | undefined) {
  if (!(await isInstancePinEnabled())) {
    return true;
  }

  return await verifyInstancePinSessionToken(token);
}

export async function requireInstancePageAccess() {
  const gate = await resolveInstanceGateState();
  if (!gate.setupCompleted) {
    redirect("/setup");
  }

  const cookieStore = await cookies();
  const instanceToken = cookieStore.get(getInstancePinCookieName())?.value;
  const tenantToken = cookieStore.get(getTenantSessionCookieName())?.value;

  if ((await hasValidInstanceSession(instanceToken)) && (await hasValidTenantSession(tenantToken))) {
    return;
  }

  redirect("/unlock");
}

export async function requireAuthenticatedPageAccess() {
  await requireInstancePageAccess();
}

export async function requireInstanceApiAccess(
  request: Request,
  kind: UnauthorizedResponseKind = "json",
) {
  const token = readCookieValue(request.headers.get("cookie"), getInstancePinCookieName());
  const tenantToken = readCookieValue(request.headers.get("cookie"), getTenantSessionCookieName());

  if ((await hasValidInstanceSession(token)) && (await hasValidTenantSession(tenantToken))) {
    return null;
  }

  const unlockUrl = buildUnlockUrl(request);
  if (kind === "redirect") {
    return NextResponse.redirect(unlockUrl, 303);
  }

  return NextResponse.json(
    {
      error: "Instance PIN required.",
      redirectPath: \`\${unlockUrl.pathname}\${unlockUrl.search}\`,
    },
    { status: 401 },
  );
}
`,
  );
}

async function redactPackageJson(outDir) {
  const relPath = "package.json";
  const packageJson = JSON.parse(await readText(outDir, relPath));
  packageJson.files = (packageJson.files || []).filter((entry) => !String(entry).includes("admin"));
  await writeText(outDir, relPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function applyPublicEditionDefaults(outDir) {
  const setupTypesPath = "src/lib/instance-setup-types.ts";
  const setupTypes = await readText(outDir, setupTypesPath);
  await writeText(
    outDir,
    setupTypesPath,
    setupTypes.replace(
      'export const DEFAULT_INSTANCE_SETUP_PREFERENCES: InstanceSetupPreferences = {\n  serviceMode: "hosted",',
      'export const DEFAULT_INSTANCE_SETUP_PREFERENCES: InstanceSetupPreferences = {\n  serviceMode: "self_hosted",',
    ),
  );

  const onboardingPath = "src/components/setup-onboarding.tsx";
  let onboarding = await readText(outDir, onboardingPath);
  onboarding = onboarding
    .replace(
      "The desktop connector keeps connected-app sessions on this machine. You can use the managed backend after a 7 day trial, or point the app at your own servers.",
      "This public build starts in self-hosted mode. Use your own Convex deployment and AI keys, or use Odogwu Cloud if you want the managed backend.",
    )
    .replace(
      'onClick={() => setPreferences((current) => ({ ...current, serviceMode: "hosted" }))}',
      'onClick={() => window.open(process.env.NEXT_PUBLIC_ODOGWU_CLOUD_URL || "https://github.com/cybermonkjbot/lifemanager", "_blank", "noopener,noreferrer")}',
    )
    .replace(
      "<strong>Managed backend</strong>\n                  <span>7 day trial, then ₦5,000 per month. We run the backend, updates, and AI control plane.</span>",
      "<strong>Use Odogwu Cloud</strong>\n                  <span>Managed backend, updates, and AI control plane. Opens the hosted service outside this self-hosted build.</span>",
    )
    .replace(
      "<span>Managed trial: 7 days.</span>\n                  <span>Monthly subscription: ₦5,000.</span>\n                  <span>Connected-app sessions remain local.</span>",
      "<span>Odogwu Cloud keeps the backend, updates, and AI control plane managed for you.</span>\n                  <span>Connected-app sessions remain local.</span>",
    )
    .replace(
      "<span>7 day trial.</span>\n                <span>₦5,000/month.</span>\n                <span>Connected-app sessions remain local.</span>",
      "<span>Self-hosted edition.</span>\n                <span>Use Odogwu Cloud if you want the backend, updates, and AI control plane managed for you.</span>\n                <span>Connected-app sessions remain local.</span>",
    )
    .replace(
      '<details className="setup-advanced">',
      '<details className="setup-advanced" open>',
    )
    .replace(
      /onChange=\{\(event\) =>\s*\n\s*setPreferences\(\(current\) => \(\{\s*\n\s*\.\.\.current,\s*\n\s*serviceMode: event\.target\.checked \? "self_hosted" : "hosted",\s*\n\s*\}\)\)\s*\n\s*\}/,
      'onChange={() => setPreferences((current) => ({ ...current, serviceMode: "self_hosted" }))}',
    );
  await writeText(outDir, onboardingPath, onboarding);
}

async function redactAdminSurface(outDir) {
  await removePrivatePaths(outDir);
  await Promise.all([
    redactTenantAccounts(outDir),
    redactSchema(outDir),
    redactConvexRefs(outDir),
    redactConvexCrons(outDir),
    writeCompatibilityStubs(outDir),
    redactInstanceGuard(outDir),
    redactPackageJson(outDir),
    applyPublicEditionDefaults(outDir),
  ]);
}

async function walkFiles(root, visit) {
  const entries = await import("node:fs/promises").then((fs) => fs.readdir(root, { withFileTypes: true }));
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(fullPath, visit);
      continue;
    }
    if (entry.isFile()) {
      await visit(fullPath);
    }
  }
}

async function verifyExport(outDir) {
  const failures = [];

  for (const relPath of PRIVATE_ADMIN_PATHS) {
    if (await exists(path.join(outDir, relPath))) {
      failures.push(`Private admin path still exists: ${relPath}`);
    }
  }

  await walkFiles(outDir, async (filePath) => {
    const relPath = toPosix(path.relative(outDir, filePath));
    const info = await stat(filePath);
    if (info.size > 5_000_000) {
      return;
    }

    const text = await readFile(filePath, "utf8").catch(() => "");
    for (const signature of SENSITIVE_SIGNATURES) {
      if (text.includes(signature)) {
        failures.push(`Sensitive admin signature "${signature}" remains in ${relPath}`);
      }
    }
  });

  if (failures.length > 0) {
    throw new Error(`Open-source export verification failed:\n- ${failures.join("\n- ")}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const outDir = await assertSafeOutDir(args.outDir);
  if (!args.verifyOnly) {
    await copyProject(outDir, args.force);
    await redactAdminSurface(outDir);
  }
  await verifyExport(outDir);

  console.log(`Open-source export is ready: ${path.relative(PROJECT_ROOT, outDir)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
