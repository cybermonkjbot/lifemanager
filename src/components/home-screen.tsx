"use client";

import { dashboardNavItems } from "@/lib/ui/dashboard-nav";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

type CommandFeedback = {
  kind: "idle" | "success" | "error";
  message: string;
};

type ManagerArtifact =
  | {
      kind: "people_list";
      title: string;
      description: string;
      people: Array<{
        threadId?: string;
        title: string;
        provider?: string;
        lastMessageAt?: number;
        reason: string;
        confidence?: number;
        genderCue?: "male" | "female" | "nonbinary" | "unknown";
        genderConfidence?: number;
        romanticFit?: "likely" | "unlikely" | "unknown";
        romanticFitReason?: string;
      }>;
    }
  | {
      kind: "communication_preview";
      title: string;
      description: string;
      previews: Array<{
        threadId?: string;
        title: string;
        messageIntent: string;
        previewText: string;
        requiresConfirmation: true;
      }>;
    };

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  kind?: CommandFeedback["kind"];
  toolSummaries?: string[];
  artifacts?: ManagerArtifact[];
};

const starterPrompts = [
  "What needs my attention right now?",
  "Find people I have not replied to in a while.",
  "Find stalled talking stages and explain the evidence.",
  "Scan my chats for follow-ups that need review.",
];

const workingPrompts = ["Scanning chats...", "Checking thread state...", "Building review lists...", "Checking available tools..."];

const errorPrompts = [
  "Try again with a smaller scan.",
  "Check system health and tell me what failed.",
  "Open system.",
  "Show me what tools are available here.",
];

const commandPrefixes = ["go to ", "go ", "open ", "navigate to ", "navigate ", "take me to ", "nav "];
const defaultRobotSceneUrl = "https://my.spline.design/interactiveaiassistant-1MceEbo4oJdzWd3AQPZq9CSB/";
const emptyStateIntro =
  "I can inspect conversations, surface what needs review, draft careful actions, and open the right section when needed.";

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9/\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeMessage(
  role: ChatMessage["role"],
  text: string,
  kind: CommandFeedback["kind"] = "idle",
  toolSummaries?: string[],
  artifacts?: ManagerArtifact[],
): ChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    kind,
    ...(toolSummaries && toolSummaries.length ? { toolSummaries } : {}),
    ...(artifacts && artifacts.length ? { artifacts } : {}),
  };
}

function isManagerArtifact(value: unknown): value is ManagerArtifact {
  if (!value || typeof value !== "object") {
    return false;
  }
  const artifact = value as { kind?: unknown; people?: unknown; previews?: unknown };
  return (
    (artifact.kind === "people_list" && Array.isArray(artifact.people)) ||
    (artifact.kind === "communication_preview" && Array.isArray(artifact.previews))
  );
}

function formatLastSeen(value?: number) {
  if (!value) {
    return "No timestamp";
  }
  const days = Math.max(0, Math.round((Date.now() - value) / 86_400_000));
  if (days === 0) {
    return "Today";
  }
  if (days === 1) {
    return "1 day ago";
  }
  if (days < 60) {
    return `${days} days ago`;
  }
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

function confidenceLabel(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
}

function genderCueLabel(value?: string, confidence?: number) {
  if (!value || value === "unknown") {
    return null;
  }
  const confidenceText = confidenceLabel(confidence);
  return confidenceText ? `${value} ${confidenceText}` : value;
}

function latestAssistantMessage(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      return messages[index];
    }
  }
  return null;
}

function uniqueSuggestions(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function buildScreenSuggestions(messages: ChatMessage[], isWorking: boolean) {
  if (isWorking) {
    return workingPrompts;
  }

  const latest = latestAssistantMessage(messages);
  if (!latest) {
    return starterPrompts;
  }

  if (latest.kind === "error") {
    return errorPrompts;
  }

  const artifacts = latest.artifacts || [];
  const hasCommunicationPreview = artifacts.some((artifact) => artifact.kind === "communication_preview" && artifact.previews.length > 0);
  const peopleLists = artifacts.filter((artifact): artifact is Extract<ManagerArtifact, { kind: "people_list" }> => artifact.kind === "people_list");
  const totalPeople = peopleLists.reduce((sum, artifact) => sum + artifact.people.length, 0);
  const titles = peopleLists.map((artifact) => artifact.title.toLowerCase()).join(" ");
  const summaries = (latest.toolSummaries || []).join(" ").toLowerCase();

  if (hasCommunicationPreview) {
    return uniqueSuggestions([
      "Rewrite these previews to sound warmer.",
      "Narrow this list to the safest 5 people.",
      "Turn these into reminder tasks instead.",
      "Find stronger evidence before messaging.",
    ]);
  }

  if (totalPeople > 0) {
    return uniqueSuggestions([
      titles.includes("dormant") ? "Draft gentle check-in previews for these dormant contacts." : "Draft careful message previews for these people.",
      titles.includes("talking-stage") ? "Explain which talking stages are worth reviving." : "Filter this list to people I have not messaged in 90 days.",
      "Find more context from chat history for this list.",
      "Turn the strongest matches into follow-up tasks.",
    ]);
  }

  if (summaries.includes("queue")) {
    return uniqueSuggestions([
      "Prioritize the queue by urgency.",
      "Show only drafts that need approval.",
      "Find the riskiest pending replies.",
      "Open queue.",
    ]);
  }

  if (summaries.includes("follow-ups")) {
    return uniqueSuggestions([
      "Show overdue follow-ups first.",
      "Draft previews for today’s follow-ups.",
      "Turn weak follow-ups into reminders.",
      "Open follow-ups.",
    ]);
  }

  if (summaries.includes("system")) {
    return uniqueSuggestions([
      "Explain the system health issues.",
      "Check what is stuck in outbox.",
      "Open system.",
      "Check worker status.",
    ]);
  }

  return uniqueSuggestions([
    "Find people I have not spoken to in a while.",
    "Search my chats for something specific.",
    "Build a message plan with approval previews.",
    "What should I review next?",
  ]);
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
  const [input, setInput] = useState("");
  const [feedback, setFeedback] = useState<CommandFeedback>({
    kind: "idle",
    message: "Ready",
  });
  const [isAwaitingOrchestrator, setIsAwaitingOrchestrator] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const robotSceneUrl = process.env.NEXT_PUBLIC_SPLINE_ACTIVITY_SCENE_URL || defaultRobotSceneUrl;
  const screenSuggestions = useMemo(
    () => buildScreenSuggestions(messages, isAwaitingOrchestrator),
    [messages, isAwaitingOrchestrator],
  );

  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!transcriptRef.current) {
      return;
    }
    transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [messages, isAwaitingOrchestrator]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const appendMessage = (message: ChatMessage) => {
    setMessages((previous) => [...previous, message]);
  };

  const runPrompt = async (prompt: string) => {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      const message = "Type a message first.";
      setFeedback({ kind: "error", message });
      return;
    }

    const nextUserMessage = makeMessage("user", normalizedPrompt);
    const nextHistory = [...messages, nextUserMessage];
    setMessages(nextHistory);
    setInput("");

    const result = getCommandTarget(normalizedPrompt);

    if (result.mode === "help") {
      const message = "Ask what needs attention, tell me to draft or inspect something, or type a direct command like open queue.";
      setFeedback({ kind: "idle", message });
      appendMessage(makeMessage("assistant", message));
      return;
    }

    if (result.mode === "route") {
      if (pathname === result.href) {
        const message = `You are already on ${result.label || result.href}.`;
        setFeedback({ kind: "idle", message });
        appendMessage(makeMessage("assistant", message));
        return;
      }
      const message = `Opening ${result.label || result.href}.`;
      setFeedback({ kind: "success", message });
      appendMessage(makeMessage("assistant", message, "success"));
      router.push(result.href);
      return;
    }

    setIsAwaitingOrchestrator(true);
    setFeedback({ kind: "idle", message: "Checking the system..." });
    try {
      const response = await fetch("/api/orchestrator/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: normalizedPrompt,
          history: nextHistory.slice(-12).map((messageItem) => ({
            role: messageItem.role,
            text: messageItem.text,
          })),
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const payload = (await response.json()) as {
        replyText?: string;
        guardrailBlocked?: boolean;
        guardrailReason?: string;
        manager?: {
          toolResults?: Array<{
            tool?: string;
            status?: string;
            summary?: string;
          }>;
          artifacts?: unknown[];
        };
      };
      if (payload.guardrailBlocked) {
        const guardrailMessage = payload.guardrailReason?.trim() || "This request is blocked by a safety rule.";
        setFeedback({ kind: "error", message: guardrailMessage });
        appendMessage(makeMessage("assistant", guardrailMessage, "error"));
        return;
      }
      const replyText = typeof payload.replyText === "string" ? payload.replyText.trim() : "";
      if (!replyText) {
        throw new Error("No response received.");
      }
      const toolSummaries =
        payload.manager?.toolResults
          ?.map((result) => {
            const tool = typeof result.tool === "string" ? result.tool : "tool";
            const status = typeof result.status === "string" ? result.status : "unknown";
            const summary = typeof result.summary === "string" ? result.summary : "";
            return `${tool} (${status}): ${summary}`;
          })
          .filter((summary) => summary.trim().length > 0) || [];
      const artifacts = payload.manager?.artifacts?.filter(isManagerArtifact) || [];
      setFeedback({ kind: "success", message: "Done" });
      appendMessage(makeMessage("assistant", replyText, "success", toolSummaries, artifacts));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not get a response.";
      setFeedback({ kind: "error", message });
      appendMessage(makeMessage("assistant", message, "error"));
    } finally {
      setIsAwaitingOrchestrator(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runPrompt(input);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void runPrompt(input);
    }
  };

  return (
    <section className="home-shell home-ai-shell" aria-label="AI chat with orchestration manager">
      <div className="home-ai-chat">
        <header className="home-ai-header">
          <div>
            <p className="home-chat-kicker">Home</p>
            <h1 className="home-chat-title">Ask Social Life Manager</h1>
          </div>
          <p className={`home-ai-status home-command-${feedback.kind}`}>{feedback.message}</p>
        </header>

        <div ref={transcriptRef} className="home-ai-transcript" role="log" aria-live="polite">
          {messages.length === 0 ? (
            <section className="home-ai-empty" aria-label="Life Manager introduction">
              <div className="home-ai-empty-copy">
                <span className="home-ai-message-role">Social Life Manager</span>
                <p>{emptyStateIntro}</p>
              </div>
              <div className="home-ai-robot" aria-hidden="true">
                <iframe title="3D Social Life Manager assistant" src={robotSceneUrl} loading="lazy" />
              </div>
            </section>
          ) : null}

          {messages.map((message) => (
            <article key={message.id} className={`home-ai-message home-ai-message-${message.role} home-ai-message-${message.kind || "idle"}`}>
              <span className="home-ai-message-role">{message.role === "user" ? "You" : "Social Life Manager"}</span>
              <p>{message.text}</p>
              {message.artifacts?.length ? (
                <div className="home-ai-artifacts" aria-label="Manager results">
                  {message.artifacts.map((artifact, artifactIndex) => (
                    <section
                      key={`${message.id}-${artifact.kind}-${artifactIndex}`}
                      className={`home-ai-artifact home-ai-artifact-${artifact.kind}`}
                    >
                      <div className="home-ai-artifact-header">
                        <div>
                          <h2>{artifact.title}</h2>
                          <span>{artifact.description}</span>
                        </div>
                        <strong>{artifact.kind === "people_list" ? artifact.people.length : artifact.previews.length}</strong>
                      </div>

                      {artifact.kind === "people_list" ? (
                        <div className="home-ai-person-list">
                          {artifact.people.slice(0, 10).map((person, personIndex) => {
                            const confidence = confidenceLabel(person.confidence);
                            const genderCue = genderCueLabel(person.genderCue, person.genderConfidence);
                            return (
                              <article key={`${person.threadId || person.title}-${personIndex}`} className="home-ai-person-row">
                                <div>
                                  <h3>{person.title}</h3>
                                  <span>{person.romanticFitReason || person.reason}</span>
                                </div>
                                <div className="home-ai-person-meta">
                                  {person.provider ? <span>{person.provider}</span> : null}
                                  {genderCue ? <span>{genderCue}</span> : null}
                                  {person.romanticFit && person.romanticFit !== "unknown" ? <span>{person.romanticFit} fit</span> : null}
                                  <span>{formatLastSeen(person.lastMessageAt)}</span>
                                  {confidence ? <span>{confidence}</span> : null}
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="home-ai-preview-list">
                          {artifact.previews.slice(0, 8).map((preview, previewIndex) => (
                            <article key={`${preview.threadId || preview.title}-${previewIndex}`} className="home-ai-preview-row">
                              <div className="home-ai-preview-topline">
                                <h3>{preview.title}</h3>
                                <span>Needs approval</span>
                              </div>
                              <p>{preview.previewText}</p>
                              <small>{preview.messageIntent}</small>
                            </article>
                          ))}
                        </div>
                      )}
                    </section>
                  ))}
                </div>
              ) : null}
              {message.toolSummaries?.length ? (
                <details className="home-ai-tool-details">
                  <summary>Manager tools</summary>
                  <ul>
                    {message.toolSummaries.map((summary) => (
                      <li key={summary}>{summary}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </article>
          ))}

          {isAwaitingOrchestrator ? (
            <article className="home-ai-message home-ai-message-assistant home-ai-thinking">
              <span className="home-ai-message-role">Social Life Manager</span>
              <p>Checking chats, tools, and review queues...</p>
            </article>
          ) : null}
        </div>

        <div className="home-ai-starters" aria-label="Contextual prompt suggestions">
          {screenSuggestions.map((prompt) => (
            <button key={prompt} type="button" onClick={() => runPrompt(prompt)} disabled={isAwaitingOrchestrator}>
              {prompt}
            </button>
          ))}
        </div>

        <form className="home-ai-composer" onSubmit={onSubmit}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Ask it to inspect, draft, summarize, route, or prepare an action..."
            aria-label="Message Social Life Manager"
            disabled={isAwaitingOrchestrator}
            rows={1}
          />
          <button type="submit" disabled={isAwaitingOrchestrator || !input.trim()}>
            {isAwaitingOrchestrator ? "Working" : "Send"}
          </button>
        </form>
      </div>
    </section>
  );
}
