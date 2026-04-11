"use client";

import { dashboardNavItems } from "@/lib/ui/dashboard-nav";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";

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

const homeFeatures: HomeFeature[] = [
  {
    href: "/queue",
    title: "Contribute ideas, offer feedback, and manage tasks all in sync.",
    description: "Triage pending replies, follow-ups, todos, and guardrails from one queue.",
    footer: "Fast Start",
    accentClass: "home-feature-mark-queue",
  },
  {
    href: "/conversations",
    title: "Stay connected, share ideas, and align goals effortlessly.",
    description: "Open thread context, tune voice, and approve outreach with clear history.",
    footer: "Collaborate with Team",
    accentClass: "home-feature-mark-conversations",
  },
  {
    href: "/followups",
    title: "Organize your time efficiently, set clear priorities, and stay focused.",
    description: "Track due outreach, commitments, and pending reminders with confidence.",
    footer: "Planning",
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
  const pathname = usePathname() || "/";
  const [commandInput, setCommandInput] = useState("");
  const [feedback, setFeedback] = useState<CommandFeedback>({
    kind: "idle",
    message: "Try: go queue, open conversations, setup, /queue",
  });

  const primaryNavItems = useMemo(() => dashboardNavItems.filter((item) => item.primary), []);

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
      <aside className="home-rail" aria-label="Quick sections">
        <p className="home-rail-title">Quick Navigation</p>
        <p className="home-rail-note">Readable links to your main workspaces.</p>
        <div className="home-rail-list">
          {primaryNavItems.map((item) => {
            const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`));
            return (
              <Link key={item.href} href={item.href} className={`home-rail-link ${active ? "home-rail-link-active" : ""}`}>
                <span className="home-rail-link-label">{item.label}</span>
                <span className="home-rail-link-note">{item.description}</span>
              </Link>
            );
          })}
        </div>
      </aside>

      <div className="home-canvas">
        <div className="home-topline">
          <p className="home-assistant">Assistant v2.6</p>
          <p className="home-title">Daily Nixtio</p>
          <button type="button" className="btn home-upgrade">
            Upgrade
          </button>
        </div>

        <div className="home-hero">
          <div className="home-hero-copy">
            <p className="home-hero-kicker">Hi Joshua</p>
            <h2 className="home-hero-title">Ready to Achieve Great Things?</h2>
          </div>
          <div className="home-avatar-wrap" aria-hidden>
            <p className="home-avatar-note">Hey there! Need a boost?</p>
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
            <p className="home-console-hint">Command box: type where you want to go.</p>
            <p className="home-console-hint">Powered by Assistant v2.6</p>
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
