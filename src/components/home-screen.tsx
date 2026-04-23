"use client";

import { dashboardNavItems } from "@/lib/ui/dashboard-nav";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

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

type HomeChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  kind?: CommandFeedback["kind"];
  timestamp: string;
};

const quickCommands = ["go queue", "open conversations", "run outreach campaign", "setup", "system"];

const commandPrefixes = ["go to ", "go ", "open ", "navigate to ", "navigate ", "take me to ", "nav "];

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9/\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getNowLabel() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function readApiError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error.trim();
    }
  } catch {
    // ignore non-JSON responses
  }
  return `Request failed (${response.status}).`;
}

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
    aliases: [normalizeText(item.label), normalizeText(item.href.replace(/^\//, ""))].filter((alias) => alias.length > 0),
  }));

  const exact = navWithAliases.find((entry) => entry.aliases.includes(target));
  if (exact) {
    return { mode: "route" as const, href: exact.item.href, label: exact.item.label };
  }

  const contains = navWithAliases.find((entry) =>
    entry.aliases.some((alias) => alias.length >= 2 && target.length >= 3 && (alias.includes(target) || target.includes(alias))),
  );

  if (contains) {
    return { mode: "route" as const, href: contains.item.href, label: contains.item.label };
  }

  return { mode: "unknown" as const, target };
}

export function HomeScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const [commandInput, setCommandInput] = useState("");
  const [setupSnapshot, setSetupSnapshot] = useState<SetupStatusSnapshot | null>(null);
  const [feedback, setFeedback] = useState<CommandFeedback>({
    kind: "idle",
    message: "Try: go queue, open conversations, run outreach campaign, setup, /queue",
  });
  const [isAwaitingOrchestrator, setIsAwaitingOrchestrator] = useState(false);
  const [messages, setMessages] = useState<HomeChatMessage[]>([
    {
      id: "boot-message",
      role: "assistant",
      kind: "idle",
      text: "Home is now command chat. Tell me where to go or what to run, and I will route you.",
      timestamp: getNowLabel(),
    },
  ]);

  const chatWindowRef = useRef<HTMLDivElement | null>(null);
  const lastStateMessageRef = useRef<string>("");

  const accountName = setupSnapshot?.accountName?.trim() || null;
  const statusLabel = useMemo(() => {
    if (setupSnapshot?.status === "connected") {
      return "Connected";
    }
    if (setupSnapshot?.status === "syncing") {
      return "Syncing";
    }
    if (setupSnapshot?.status === "error") {
      return "Attention needed";
    }
    return "Ready";
  }, [setupSnapshot?.status]);
  const setupStateLabel = useMemo(() => summarizeSetupState(setupSnapshot), [setupSnapshot]);
  const nextStep = useMemo(() => summarizeNextStep(setupSnapshot), [setupSnapshot]);

  const pushMessage = (entry: Omit<HomeChatMessage, "id" | "timestamp">) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setMessages((prev) => [
      ...prev,
      {
        ...entry,
        id,
        timestamp: getNowLabel(),
      },
    ]);
  };

  useEffect(() => {
    if (!chatWindowRef.current) {
      return;
    }
    chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
  }, [messages]);

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
          const stateLabel = summarizeSetupState(payload);
          const next = summarizeNextStep(payload);
          const setupMessage = payload.message?.trim();
          const stateSummary = `Setup state: ${stateLabel}. ${setupMessage ? setupMessage : next}`;
          if (stateSummary !== lastStateMessageRef.current) {
            lastStateMessageRef.current = stateSummary;
            pushMessage({ role: "assistant", text: stateSummary, kind: "idle" });
          }
        }
      } catch {
        // Keep generic greeting when setup status is unavailable.
      }
    };

    void loadSetupName();

    return () => {
      cancelled = true;
    };
  }, []);

  const runCommand = async (command: string) => {
    pushMessage({ role: "user", text: command, kind: "idle" });

    const result = getCommandTarget(command);

    if (result.mode === "empty") {
      const message = "Type a command first.";
      setFeedback({ kind: "error", message });
      pushMessage({ role: "assistant", text: message, kind: "error" });
      return;
    }

    if (result.mode === "help") {
      const message =
        "Commands: go <tab>, open <tab>, /route. Natural language also works for task intents and routes to conversations tooling.";
      setFeedback({ kind: "idle", message });
      pushMessage({ role: "assistant", text: message, kind: "idle" });
      return;
    }

    if (result.mode === "route") {
      setCommandInput("");
      if (pathname === result.href) {
        const message = `Already on ${result.label || result.href}`;
        setFeedback({ kind: "idle", message });
        pushMessage({ role: "assistant", text: message, kind: "idle" });
        return;
      }
      const message = `Navigating to ${result.label || result.href}`;
      setFeedback({ kind: "success", message });
      pushMessage({ role: "assistant", text: message, kind: "success" });
      router.push(result.href);
      return;
    }

    setIsAwaitingOrchestrator(true);
    setFeedback({ kind: "idle", message: "Thinking..." });
    try {
      const response = await fetch("/api/actions/test-ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: command,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const payload = (await response.json()) as {
        replyText?: string;
        guardrailBlocked?: boolean;
        guardrailReason?: string;
      };
      if (payload.guardrailBlocked) {
        const guardrailMessage = payload.guardrailReason?.trim() || "Blocked by guardrail.";
        setFeedback({ kind: "error", message: guardrailMessage });
        pushMessage({ role: "assistant", text: guardrailMessage, kind: "error" });
        return;
      }
      const replyText = typeof payload.replyText === "string" ? payload.replyText.trim() : "";
      if (!replyText) {
        throw new Error("Orchestrator returned an empty reply.");
      }
      setFeedback({ kind: "success", message: "Response generated." });
      pushMessage({ role: "assistant", text: replyText, kind: "success" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not get orchestrator response.";
      const fallback =
        setupStateLabel === "Connected"
          ? `${message} Try: go queue or open conversations.`
          : `${message} Try setup first, then go queue.`;
      setFeedback({ kind: "error", message: fallback });
      pushMessage({ role: "assistant", text: fallback, kind: "error" });
    } finally {
      setIsAwaitingOrchestrator(false);
    }
  };

  const onCommandSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runCommand(commandInput);
  };

  return (
    <section className="home-shell" aria-label="Home chat">
      <div className="home-canvas">
        <div className="home-topline">
          <p className="home-assistant">Assistant v2.6</p>
          <h1 className="home-title">Daily Nixtio</h1>
        </div>

        <div className="home-chat-platform">
          <header className="home-chat-header">
            <p className="home-chat-kicker">{accountName ? `Welcome back, ${accountName}` : "Welcome back"}</p>
            <h2 className="home-chat-title">Home chat</h2>
            <p className="home-chat-status">Status: {statusLabel}</p>
            <p className="home-chat-status">Setup: {setupStateLabel}</p>
            <p className="home-chat-status">Next: {nextStep}</p>
          </header>

          <div className="conversation-chat home-conversation-chat">
            <div ref={chatWindowRef} className="conversation-chat-window home-chat-window" role="log" aria-live="polite">
              {messages.map((message) => {
                const outbound = message.role === "user";
                const toneClass = message.kind ? `home-bubble-${message.kind}` : "";
                return (
                  <div key={message.id} className={`chat-row ${outbound ? "outbound" : "inbound"}`}>
                    <span className={`chat-avatar ${outbound ? "outbound" : "inbound"}`} aria-hidden="true">
                      {outbound ? "You" : "AI"}
                    </span>
                    <div className={`message-bubble ${toneClass}`}>
                      <p>{message.text}</p>
                      <span>{message.timestamp}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <form className="home-prompt-row" onSubmit={onCommandSubmit}>
            <button type="button" className="home-plus" aria-label="Show command help" onClick={() => runCommand("help")}>
              ?
            </button>
            <input
              type="text"
              className="home-prompt-input"
              placeholder="Message Home: go queue"
              aria-label="Chat command input"
              value={commandInput}
              onChange={(event) => setCommandInput(event.target.value)}
              disabled={isAwaitingOrchestrator}
            />
            <button type="submit" className="home-send" aria-label="Send command" disabled={isAwaitingOrchestrator}>
              {isAwaitingOrchestrator ? "..." : "Send"}
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
                  void runCommand(command);
                }}
                disabled={isAwaitingOrchestrator}
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
