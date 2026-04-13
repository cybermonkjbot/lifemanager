"use client";

import { dashboardNavItems } from "@/lib/ui/dashboard-nav";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

type HomeFeature = {
  href: string;
  title: string;
  description: string;
  footer: string;
  accentClass: string;
};

type CommandFeedback = {
  kind: "idle" | "success" | "error";
  message: string;
};

type SetupStatusSnapshot = {
  accountName?: string;
  status?: "idle" | "starting" | "authenticating" | "qr_ready" | "code_ready" | "syncing" | "connected" | "error";
  hasAuth?: boolean;
  listenerActive?: boolean;
  message?: string;
};

function summarizeSetupState(snapshot: SetupStatusSnapshot | null) {
  if (!snapshot) {
    return "Loading";
  }
  if (snapshot.listenerActive || snapshot.status === "connected") {
    return "Connected";
  }
  if (snapshot.hasAuth) {
    return "Paired";
  }
  if (
    snapshot.status === "starting" ||
    snapshot.status === "authenticating" ||
    snapshot.status === "qr_ready" ||
    snapshot.status === "code_ready" ||
    snapshot.status === "syncing"
  ) {
    return "In progress";
  }
  if (snapshot.status === "error") {
    return "Attention needed";
  }
  return "Not connected";
}

function summarizeNextStep(snapshot: SetupStatusSnapshot | null) {
  if (!snapshot) {
    return "Wait for setup state to load, then process queue.";
  }
  if (snapshot.listenerActive || snapshot.status === "connected") {
    return "Runtime is live. Start with queue triage.";
  }
  if (snapshot.hasAuth) {
    return "Start worker from Setup to move from paired to connected.";
  }
  if (snapshot.status === "error") {
    return "Open Setup and restart pairing.";
  }
  return "Open Setup to connect WhatsApp first.";
}

const homeFeatures: HomeFeature[] = [
  {
    href: "/queue",
    title: "Process pending work from one queue.",
    description: "Handle replies, follow-ups, todos, and safety checks in one place.",
    footer: "Open Queue",
    accentClass: "home-feature-mark-queue",
  },
  {
    href: "/conversations",
    title: "Review thread context before sending.",
    description: "Check history, adjust tone, and approve outreach with full context.",
    footer: "Open Conversations",
    accentClass: "home-feature-mark-conversations",
  },
  {
    href: "/followups",
    title: "Keep commitments and reminders on track.",
    description: "Track due outreach, snooze items, and confirm completed follow-ups.",
    footer: "Open Follow-ups",
    accentClass: "home-feature-mark-followups",
  },
];

const quickCommands = ["go queue", "open conversations", "status", "setup", "system"];

const commandPrefixes = ["go to ", "go ", "open ", "navigate to ", "navigate ", "take me to ", "nav "];

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9/\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCommandTarget(command: string) {
  const normalized = normalizeText(command);
  if (!normalized) {
    return { mode: "empty" as const };
  }
  if (normalized === "help" || normalized === "commands") {
    return { mode: "help" as const };
  }

  let target = normalized;
  for (const prefix of commandPrefixes) {
    if (target.startsWith(prefix)) {
      target = target.slice(prefix.length).trim();
      break;
    }
  }

  if (!target) {
    return { mode: "invalid" as const };
  }

  if (target.startsWith("/")) {
    return { mode: "route" as const, href: target };
  }

  const navWithAliases = dashboardNavItems.map((item) => ({
    item,
    label: normalizeText(item.label),
    href: normalizeText(item.href),
    aliases: [normalizeText(item.label), normalizeText(item.href.replace(/^\//, ""))],
  }));

  const exact = navWithAliases.find((entry) => entry.aliases.includes(target));
  if (exact) {
    return { mode: "route" as const, href: exact.item.href, label: exact.item.label };
  }

  const contains = navWithAliases.find((entry) =>
    entry.aliases.some((alias) => alias.includes(target) || target.includes(alias)),
  );

  if (contains) {
    return { mode: "route" as const, href: contains.item.href, label: contains.item.label };
  }

  return { mode: "unknown" as const, target };
}

export function HomeScreen() {
  const router = useRouter();
  const [commandInput, setCommandInput] = useState("");
  const [setupSnapshot, setSetupSnapshot] = useState<SetupStatusSnapshot | null>(null);
  const [feedback, setFeedback] = useState<CommandFeedback>({
    kind: "idle",
    message: "Try: go queue, open conversations, setup, /queue",
  });

  useEffect(() => {
    let cancelled = false;

    const loadSetupName = async () => {
      try {
        const response = await fetch("/api/setup/whatsapp/status", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as SetupStatusSnapshot;
        if (!cancelled) {
          setSetupSnapshot(payload);
        }
      } catch {
        // Keep generic rail/greeting when setup status is unavailable.
      }
    };

    void loadSetupName();

    return () => {
      cancelled = true;
    };
  }, []);

  const accountName = setupSnapshot?.accountName?.trim() || null;
  const setupStateLabel = summarizeSetupState(setupSnapshot);
  const setupMessage = setupSnapshot?.message?.trim() || "Setup status will appear when runtime responds.";
  const nextStep = summarizeNextStep(setupSnapshot);

  const runCommand = (command: string) => {
    const result = getCommandTarget(command);

    if (result.mode === "empty") {
      setFeedback({ kind: "error", message: "Type a command first." });
      return;
    }

    if (result.mode === "help") {
      setFeedback({
        kind: "idle",
        message: "Commands: go <tab>, open <tab>, /route. Example: go queue",
      });
      return;
    }

    if (result.mode === "route") {
      router.push(result.href);
      setFeedback({
        kind: "success",
        message: `Navigating to ${result.label || result.href}`,
      });
      setCommandInput("");
      return;
    }

    setFeedback({
      kind: "error",
      message: `Unknown command: ${result.mode === "unknown" ? result.target : command}`,
    });
  };

  const onCommandSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runCommand(commandInput);
  };

  return (
    <section className="home-shell" aria-label="Home overview">
      <section className="home-rail" aria-label="Quick sections">
        <p className="home-rail-title">Desk Brief</p>
        <p className="home-rail-note">Live setup context and next-step guidance.</p>
        <div className="home-rail-list">
          <article className="home-rail-card">
            <div className="home-rail-card-topline">
              <span className="home-rail-card-label">Profile Name</span>
              <span className="home-rail-card-value">{accountName || "Unknown"}</span>
            </div>
            <p className="home-rail-card-note">Loaded from WhatsApp setup credentials.</p>
          </article>
          <article className="home-rail-card">
            <div className="home-rail-card-topline">
              <span className="home-rail-card-label">WhatsApp Setup</span>
              <span className="home-rail-card-value">{setupStateLabel}</span>
            </div>
            <p className="home-rail-card-note">{setupMessage}</p>
          </article>
          <article className="home-rail-card">
            <div className="home-rail-card-topline">
              <span className="home-rail-card-label">Command Pattern</span>
              <span className="home-rail-card-value">go &lt;section&gt;</span>
            </div>
            <p className="home-rail-card-note">Also supports open &lt;section&gt; and direct /route input.</p>
          </article>
          <article className="home-rail-card">
            <div className="home-rail-card-topline">
              <span className="home-rail-card-label">Recommended Next Step</span>
            </div>
            <p className="home-rail-card-note">{nextStep}</p>
          </article>
        </div>
      </section>

      <div className="home-canvas">
        <div className="home-topline">
          <p className="home-assistant">Assistant v2.6</p>
          <h1 className="home-title">Daily Nixtio</h1>
        </div>

        <div className="home-hero">
          <div className="home-hero-copy">
            <p className="home-hero-kicker">{accountName ? `Welcome back, ${accountName}` : "Welcome back"}</p>
            <h2 className="home-hero-title">What needs attention right now?</h2>
          </div>
          <div className="home-avatar-wrap" aria-hidden>
            <p className="home-avatar-note">Need help picking the next task?</p>
            <div className="home-avatar">
              <div className="home-avatar-face">
                <span />
                <span />
              </div>
            </div>
          </div>
        </div>

        <div className="home-feature-grid">
          {homeFeatures.map((feature) => (
            <Link key={feature.href} href={feature.href} className="home-feature-card">
              <span className={`home-feature-mark ${feature.accentClass}`} aria-hidden />
              <p className="home-feature-title">{feature.title}</p>
              <p className="home-feature-copy">{feature.description}</p>
              <p className="home-feature-footer">{feature.footer}</p>
            </Link>
          ))}
        </div>

        <div className="home-console">
          <div className="home-console-meta">
            <p className="home-console-hint">Command line: type the workspace or route you want.</p>
            <p className="home-console-hint">Tip: use go &lt;tab&gt;, open &lt;tab&gt;, or /route.</p>
          </div>
          <form className="home-prompt-row" onSubmit={onCommandSubmit}>
            <button type="button" className="home-plus" aria-label="Show command help" onClick={() => runCommand("help")}>
              ?
            </button>
            <input
              type="text"
              className="home-prompt-input"
              placeholder="Try: go queue"
              aria-label="Command input"
              value={commandInput}
              onChange={(event) => setCommandInput(event.target.value)}
            />
            <button type="submit" className="home-send" aria-label="Run command">
              Run
            </button>
          </form>
          <p className={`home-command-feedback home-command-${feedback.kind}`}>{feedback.message}</p>
          <div className="home-action-row" aria-label="Suggested commands">
            {quickCommands.map((command) => (
              <button
                key={command}
                type="button"
                className="home-action-chip"
                onClick={() => {
                  setCommandInput(command);
                  runCommand(command);
                }}
              >
                {command}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
