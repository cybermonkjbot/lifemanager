"use client";

import { ActionNotices } from "@/components/action-notices";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { api } from "../../convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { FormEvent, useEffect, useMemo, useState } from "react";

type SettingsState = {
  ignoreGroupsByDefault: boolean;
  reactionsEnabled: boolean;
  stickersEnabled: boolean;
  memesEnabled: boolean;
  soulModeEnabled: boolean;
  humorLearningEnabled: boolean;
  statusAutoReplyEnabled: boolean;
  statusReplyRequireFunny: boolean;
  funnyStatusKeywords: string[];
  funnyStatusEmojis: string[];
  aiFallbackMode: "all" | "azure_only";
  aiTemperature: number;
  aiMaxOutputTokens: number;
  aiMaxReplyChars: number;
  aiHistoryLineLimit: number;
  aiPrimaryConfidence: number;
  aiFallbackConfidence: number;
  aiReplyPolicy: string;
  aiSystemInstruction: string;
  activePersonaPackId: string;
  qualityGateMode: "auto_rewrite_once" | "manual_review" | "log_only";
  qualityGateThreshold: number;
  humanDelayMinMs: number;
  humanDelayMaxMs: number;
  humanTypingMinMs: number;
  humanTypingMaxMs: number;
  outboxClaimLimit: number;
  outboxPollMs: number;
  inboundMergeWindowMs: number;
  manualInterventionCooldownMs: number;
  quietHoursEnabled: boolean;
  quietHoursStartHour: number;
  quietHoursEndHour: number;
  sendRateWindowMinutes: number;
  sendMaxPerThreadInWindow: number;
  sendMaxGlobalInWindow: number;
  outreachEnabled: boolean;
  outreachCadenceHours: number;
  outreachMaxContactsPerRun: number;
  outreachContactJids: string[];
  outreachStarterTemplate: string;
};

type KnownContact = {
  _id: string;
  jid: string;
  title?: string;
};

function toState(source: Partial<SettingsState> | undefined): SettingsState {
  return {
    ignoreGroupsByDefault: source?.ignoreGroupsByDefault ?? true,
    reactionsEnabled: source?.reactionsEnabled ?? true,
    stickersEnabled: source?.stickersEnabled ?? true,
    memesEnabled: source?.memesEnabled ?? true,
    soulModeEnabled: source?.soulModeEnabled ?? true,
    humorLearningEnabled: source?.humorLearningEnabled ?? true,
    statusAutoReplyEnabled: source?.statusAutoReplyEnabled ?? true,
    statusReplyRequireFunny: source?.statusReplyRequireFunny ?? true,
    funnyStatusKeywords:
      source?.funnyStatusKeywords ?? ["lol", "lmao", "haha", "funny", "joke", "banter", "meme", "wild", "roast", "status", "story", "dead"],
    funnyStatusEmojis: source?.funnyStatusEmojis ?? ["😂", "🤣", "😹", "😆", "😅", "😄", "😁", "😜", "🤪", "🙃", "🔥", "💀"],
    aiFallbackMode: source?.aiFallbackMode ?? "all",
    aiTemperature: source?.aiTemperature ?? 0.7,
    aiMaxOutputTokens: source?.aiMaxOutputTokens ?? 140,
    aiMaxReplyChars: source?.aiMaxReplyChars ?? 320,
    aiHistoryLineLimit: source?.aiHistoryLineLimit ?? 12,
    aiPrimaryConfidence: source?.aiPrimaryConfidence ?? 0.78,
    aiFallbackConfidence: source?.aiFallbackConfidence ?? 0.58,
    aiReplyPolicy: source?.aiReplyPolicy ?? "",
    aiSystemInstruction: source?.aiSystemInstruction ?? "",
    activePersonaPackId: source?.activePersonaPackId ?? "",
    qualityGateMode: source?.qualityGateMode ?? "auto_rewrite_once",
    qualityGateThreshold: source?.qualityGateThreshold ?? 0.72,
    humanDelayMinMs: source?.humanDelayMinMs ?? 12000,
    humanDelayMaxMs: source?.humanDelayMaxMs ?? 65000,
    humanTypingMinMs: source?.humanTypingMinMs ?? 2500,
    humanTypingMaxMs: source?.humanTypingMaxMs ?? 9000,
    outboxClaimLimit: source?.outboxClaimLimit ?? 8,
    outboxPollMs: source?.outboxPollMs ?? 3000,
    inboundMergeWindowMs: source?.inboundMergeWindowMs ?? 45000,
    manualInterventionCooldownMs: source?.manualInterventionCooldownMs ?? 120000,
    quietHoursEnabled: source?.quietHoursEnabled ?? false,
    quietHoursStartHour: source?.quietHoursStartHour ?? 23,
    quietHoursEndHour: source?.quietHoursEndHour ?? 7,
    sendRateWindowMinutes: source?.sendRateWindowMinutes ?? 60,
    sendMaxPerThreadInWindow: source?.sendMaxPerThreadInWindow ?? 4,
    sendMaxGlobalInWindow: source?.sendMaxGlobalInWindow ?? 40,
    outreachEnabled: source?.outreachEnabled ?? false,
    outreachCadenceHours: source?.outreachCadenceHours ?? 36,
    outreachMaxContactsPerRun: source?.outreachMaxContactsPerRun ?? 3,
    outreachContactJids: source?.outreachContactJids ?? [],
    outreachStarterTemplate: source?.outreachStarterTemplate ?? "Hey {{name}}, checking in on you today.",
  };
}

function nearlyEqual(a: number, b: number) {
  return Math.abs(a - b) < 0.00001;
}

function stateEquals(a: SettingsState, b: SettingsState) {
  return (
    a.ignoreGroupsByDefault === b.ignoreGroupsByDefault &&
    a.reactionsEnabled === b.reactionsEnabled &&
    a.stickersEnabled === b.stickersEnabled &&
    a.memesEnabled === b.memesEnabled &&
    a.soulModeEnabled === b.soulModeEnabled &&
    a.humorLearningEnabled === b.humorLearningEnabled &&
    a.statusAutoReplyEnabled === b.statusAutoReplyEnabled &&
    a.statusReplyRequireFunny === b.statusReplyRequireFunny &&
    a.funnyStatusKeywords.join("\n") === b.funnyStatusKeywords.join("\n") &&
    a.funnyStatusEmojis.join("\n") === b.funnyStatusEmojis.join("\n") &&
    a.aiFallbackMode === b.aiFallbackMode &&
    nearlyEqual(a.aiTemperature, b.aiTemperature) &&
    nearlyEqual(a.aiMaxOutputTokens, b.aiMaxOutputTokens) &&
    nearlyEqual(a.aiMaxReplyChars, b.aiMaxReplyChars) &&
    nearlyEqual(a.aiHistoryLineLimit, b.aiHistoryLineLimit) &&
    nearlyEqual(a.aiPrimaryConfidence, b.aiPrimaryConfidence) &&
    nearlyEqual(a.aiFallbackConfidence, b.aiFallbackConfidence) &&
    a.aiReplyPolicy === b.aiReplyPolicy &&
    a.aiSystemInstruction === b.aiSystemInstruction &&
    a.activePersonaPackId === b.activePersonaPackId &&
    a.qualityGateMode === b.qualityGateMode &&
    nearlyEqual(a.qualityGateThreshold, b.qualityGateThreshold) &&
    nearlyEqual(a.humanDelayMinMs, b.humanDelayMinMs) &&
    nearlyEqual(a.humanDelayMaxMs, b.humanDelayMaxMs) &&
    nearlyEqual(a.humanTypingMinMs, b.humanTypingMinMs) &&
    nearlyEqual(a.humanTypingMaxMs, b.humanTypingMaxMs) &&
    nearlyEqual(a.outboxClaimLimit, b.outboxClaimLimit) &&
    nearlyEqual(a.outboxPollMs, b.outboxPollMs) &&
    nearlyEqual(a.inboundMergeWindowMs, b.inboundMergeWindowMs) &&
    nearlyEqual(a.manualInterventionCooldownMs, b.manualInterventionCooldownMs) &&
    a.quietHoursEnabled === b.quietHoursEnabled &&
    nearlyEqual(a.quietHoursStartHour, b.quietHoursStartHour) &&
    nearlyEqual(a.quietHoursEndHour, b.quietHoursEndHour) &&
    nearlyEqual(a.sendRateWindowMinutes, b.sendRateWindowMinutes) &&
    nearlyEqual(a.sendMaxPerThreadInWindow, b.sendMaxPerThreadInWindow) &&
    nearlyEqual(a.sendMaxGlobalInWindow, b.sendMaxGlobalInWindow) &&
    a.outreachEnabled === b.outreachEnabled &&
    nearlyEqual(a.outreachCadenceHours, b.outreachCadenceHours) &&
    nearlyEqual(a.outreachMaxContactsPerRun, b.outreachMaxContactsPerRun) &&
    a.outreachStarterTemplate === b.outreachStarterTemplate &&
    a.outreachContactJids.join("\n") === b.outreachContactJids.join("\n")
  );
}

function parseNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseContactJids(value: string) {
  return [...new Set(value.split("\n").map((item) => item.trim()).filter(Boolean))];
}

function parseSimpleList(value: string, lowercase = false) {
  const normalized = value
    .split(/[\n,]/)
    .map((item) => (lowercase ? item.trim().toLowerCase() : item.trim()))
    .filter(Boolean);
  return [...new Set(normalized)];
}

export function LiveSettings() {
  const saveSettings = useMutation(api.settings.save);
  const settings = useQuery(api.settings.get, {}) as SettingsState | undefined;
  const defaults = useQuery(api.settings.defaults, {}) as SettingsState | undefined;
  const contacts = useQuery(api.threads.listContacts, { limit: 300 }) as KnownContact[] | undefined;
  const settingsLoading = settings === undefined || defaults === undefined;
  const contactsLoading = contacts === undefined;
  const { runAction, getRecord, notices, dismissNotice } = useActionStateRegistry();
  const key = "settings:save";

  const remoteState = useMemo(() => toState(settings), [settings]);
  const defaultState = useMemo(() => toState(defaults), [defaults]);
  const knownContacts = useMemo(() => contacts || [], [contacts]);
  const [draft, setDraft] = useState<SettingsState>(remoteState);

  useEffect(() => {
    setDraft(remoteState);
  }, [remoteState]);

  const hasChanged = useMemo(() => !stateEquals(draft, remoteState), [draft, remoteState]);
  const record = getRecord(key);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hasChanged) {
      return;
    }

    void runAction(
      key,
      async () => {
        await saveSettings({
          ignoreGroupsByDefault: draft.ignoreGroupsByDefault,
          reactionsEnabled: draft.reactionsEnabled,
          stickersEnabled: draft.stickersEnabled,
          memesEnabled: draft.memesEnabled,
          soulModeEnabled: draft.soulModeEnabled,
          humorLearningEnabled: draft.humorLearningEnabled,
          statusAutoReplyEnabled: draft.statusAutoReplyEnabled,
          statusReplyRequireFunny: draft.statusReplyRequireFunny,
          funnyStatusKeywords: draft.funnyStatusKeywords,
          funnyStatusEmojis: draft.funnyStatusEmojis,
          aiFallbackMode: draft.aiFallbackMode,
          aiTemperature: draft.aiTemperature,
          aiMaxOutputTokens: Math.round(draft.aiMaxOutputTokens),
          aiMaxReplyChars: Math.round(draft.aiMaxReplyChars),
          aiHistoryLineLimit: Math.round(draft.aiHistoryLineLimit),
          aiPrimaryConfidence: draft.aiPrimaryConfidence,
          aiFallbackConfidence: draft.aiFallbackConfidence,
          aiReplyPolicy: draft.aiReplyPolicy,
          aiSystemInstruction: draft.aiSystemInstruction,
          activePersonaPackId: draft.activePersonaPackId,
          qualityGateMode: draft.qualityGateMode,
          qualityGateThreshold: draft.qualityGateThreshold,
          humanDelayMinMs: Math.round(draft.humanDelayMinMs),
          humanDelayMaxMs: Math.round(draft.humanDelayMaxMs),
          humanTypingMinMs: Math.round(draft.humanTypingMinMs),
          humanTypingMaxMs: Math.round(draft.humanTypingMaxMs),
          outboxClaimLimit: Math.round(draft.outboxClaimLimit),
          outboxPollMs: Math.round(draft.outboxPollMs),
          inboundMergeWindowMs: Math.round(draft.inboundMergeWindowMs),
          manualInterventionCooldownMs: Math.round(draft.manualInterventionCooldownMs),
          quietHoursEnabled: draft.quietHoursEnabled,
          quietHoursStartHour: Math.round(draft.quietHoursStartHour),
          quietHoursEndHour: Math.round(draft.quietHoursEndHour),
          sendRateWindowMinutes: Math.round(draft.sendRateWindowMinutes),
          sendMaxPerThreadInWindow: Math.round(draft.sendMaxPerThreadInWindow),
          sendMaxGlobalInWindow: Math.round(draft.sendMaxGlobalInWindow),
          outreachEnabled: draft.outreachEnabled,
          outreachCadenceHours: Math.round(draft.outreachCadenceHours),
          outreachMaxContactsPerRun: Math.round(draft.outreachMaxContactsPerRun),
          outreachContactJids: draft.outreachContactJids,
          outreachStarterTemplate: draft.outreachStarterTemplate,
        });
      },
      {
        pendingLabel: "Saving...",
        successMessage: "Settings saved.",
      },
    );
  };

  const restoreDefaults = () => {
    setDraft(defaultState);
  };

  const addOutreachContact = (jid: string) => {
    const normalized = jid.trim();
    if (!normalized) {
      return;
    }

    setDraft((prev) => {
      if (prev.outreachContactJids.includes(normalized)) {
        return prev;
      }
      return {
        ...prev,
        outreachContactJids: [...prev.outreachContactJids, normalized],
      };
    });
  };

  const removeOutreachContact = (jid: string) => {
    setDraft((prev) => ({
      ...prev,
      outreachContactJids: prev.outreachContactJids.filter((item) => item !== jid),
    }));
  };

  if (settingsLoading) {
    return (
      <section className="panel-grid two-col">
        <article className="panel-card">
          <ActionNotices notices={notices} onDismiss={dismissNotice} />
          <h3>AI Runtime</h3>
          <p className="empty-line">Loading settings…</p>
        </article>
        <article className="panel-card">
          <h3>Pacing & Queue</h3>
          <p className="empty-line">Loading worker defaults…</p>
        </article>
      </section>
    );
  }

  return (
    <section className="panel-grid two-col">
      <article className="panel-card">
        <ActionNotices notices={notices} onDismiss={dismissNotice} />
        <h3>AI Runtime</h3>
        <form onSubmit={onSubmit} className="stack compact" aria-busy={record.pending}>
          <label className="stack compact">
            <span className="queue-meta">Temperature</span>
            <input
              type="number"
              min={0}
              max={1.3}
              step={0.01}
              value={draft.aiTemperature}
              onChange={(event) => setDraft((prev) => ({ ...prev, aiTemperature: parseNumber(event.target.value, prev.aiTemperature) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Max output tokens</span>
            <input
              type="number"
              min={40}
              max={1000}
              step={1}
              value={draft.aiMaxOutputTokens}
              onChange={(event) => setDraft((prev) => ({ ...prev, aiMaxOutputTokens: parseNumber(event.target.value, prev.aiMaxOutputTokens) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Max reply chars</span>
            <input
              type="number"
              min={60}
              max={1200}
              step={1}
              value={draft.aiMaxReplyChars}
              onChange={(event) => setDraft((prev) => ({ ...prev, aiMaxReplyChars: parseNumber(event.target.value, prev.aiMaxReplyChars) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">History line limit</span>
            <input
              type="number"
              min={4}
              max={40}
              step={1}
              value={draft.aiHistoryLineLimit}
              onChange={(event) => setDraft((prev) => ({ ...prev, aiHistoryLineLimit: parseNumber(event.target.value, prev.aiHistoryLineLimit) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Fallback mode</span>
            <select
              value={draft.aiFallbackMode}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  aiFallbackMode: event.target.value === "azure_only" ? "azure_only" : "all",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="all">Allow Codex + heuristic fallback</option>
              <option value="azure_only">Azure only (disable all fallback providers)</option>
            </select>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Primary confidence</span>
            <input
              type="number"
              min={0.01}
              max={1}
              step={0.01}
              value={draft.aiPrimaryConfidence}
              onChange={(event) => setDraft((prev) => ({ ...prev, aiPrimaryConfidence: parseNumber(event.target.value, prev.aiPrimaryConfidence) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Heuristic fallback confidence</span>
            <input
              type="number"
              min={0.01}
              max={1}
              step={0.01}
              value={draft.aiFallbackConfidence}
              onChange={(event) => setDraft((prev) => ({ ...prev, aiFallbackConfidence: parseNumber(event.target.value, prev.aiFallbackConfidence) }))}
              disabled={record.pending || draft.aiFallbackMode === "azure_only"}
              aria-disabled={record.pending || draft.aiFallbackMode === "azure_only"}
            />
            {draft.aiFallbackMode === "azure_only" ? (
              <span className="queue-meta">Not used in Azure-only mode.</span>
            ) : null}
          </label>

          <label className="stack compact">
            <span className="queue-meta">AI reply policy (optional)</span>
            <textarea
              name="aiReplyPolicy"
              value={draft.aiReplyPolicy}
              rows={3}
              onChange={(event) => setDraft((prev) => ({ ...prev, aiReplyPolicy: event.target.value }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">AI system instruction override (optional)</span>
            <textarea
              name="aiSystemInstruction"
              value={draft.aiSystemInstruction}
              rows={3}
              onChange={(event) => setDraft((prev) => ({ ...prev, aiSystemInstruction: event.target.value }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Active persona pack (optional)</span>
            <input
              name="activePersonaPackId"
              value={draft.activePersonaPackId}
              placeholder="josh_witty_shortcuts.v1"
              onChange={(event) => setDraft((prev) => ({ ...prev, activePersonaPackId: event.target.value }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Quality gate mode</span>
            <select
              value={draft.qualityGateMode}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  qualityGateMode:
                    event.target.value === "manual_review"
                      ? "manual_review"
                      : event.target.value === "log_only"
                        ? "log_only"
                        : "auto_rewrite_once",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="auto_rewrite_once">Auto rewrite once</option>
              <option value="manual_review">Manual review</option>
              <option value="log_only">Log only</option>
            </select>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Quality gate threshold</span>
            <input
              type="number"
              min={0.4}
              max={0.95}
              step={0.01}
              value={draft.qualityGateThreshold}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  qualityGateThreshold: parseNumber(event.target.value, prev.qualityGateThreshold),
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <div className="topbar-controls">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={record.pending || !hasChanged}
              aria-disabled={record.pending || !hasChanged}
            >
              {record.pending ? "Saving..." : "Save Settings"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={restoreDefaults}
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              Restore Defaults
            </button>
          </div>
        </form>
      </article>

      <article className="panel-card">
        <h3>Pacing & Queue</h3>
        <div className="stack compact">
          <label className="stack compact">
            <span className="queue-meta">Ignore groups by default</span>
            <select
              value={draft.ignoreGroupsByDefault ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  ignoreGroupsByDefault: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Enable reactions</span>
            <select
              value={draft.reactionsEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  reactionsEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Enable stickers</span>
            <select
              value={draft.stickersEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  stickersEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Enable memes</span>
            <select
              value={draft.memesEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  memesEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Soul mode</span>
            <select
              value={draft.soulModeEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  soulModeEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="true">On (identity-led voice: everything sounds like me)</option>
              <option value="false">Off (neutral tone)</option>
            </select>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Humor learning</span>
            <select
              value={draft.humorLearningEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  humorLearningEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="true">On (learn from positive funny signals)</option>
              <option value="false">Off</option>
            </select>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Status auto-replies</span>
            <select
              value={draft.statusAutoReplyEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  statusAutoReplyEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="true">On</option>
              <option value="false">Off</option>
            </select>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Status reply mode</span>
            <select
              value={draft.statusReplyRequireFunny ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  statusReplyRequireFunny: event.target.value === "true",
                }))
              }
              disabled={record.pending || !draft.statusAutoReplyEnabled}
              aria-disabled={record.pending || !draft.statusAutoReplyEnabled}
            >
              <option value="true">Funny/playful + science/tech/AI + NGX/crypto/forex news</option>
              <option value="false">Any status text</option>
            </select>
            {!draft.statusAutoReplyEnabled ? <span className="queue-meta">Enable status auto-replies to use this.</span> : null}
            <span className="queue-meta">Safety rule: status replies are always skipped if the status contains a link or email address.</span>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Funny status keywords (comma or new line)</span>
            <textarea
              rows={3}
              value={draft.funnyStatusKeywords.join("\n")}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  funnyStatusKeywords: parseSimpleList(event.target.value, true),
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
            <span className="queue-meta">
              Used for playful detection. Status interest matching is always on for science/tech/AI and Nigerian markets (NGX), crypto, and forex.
            </span>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Funny status emojis (comma or new line)</span>
            <textarea
              rows={2}
              value={draft.funnyStatusEmojis.join("\n")}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  funnyStatusEmojis: parseSimpleList(event.target.value, false),
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Delay min (ms)</span>
            <input
              type="number"
              min={500}
              max={180000}
              step={100}
              value={draft.humanDelayMinMs}
              onChange={(event) => setDraft((prev) => ({ ...prev, humanDelayMinMs: parseNumber(event.target.value, prev.humanDelayMinMs) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Delay max (ms)</span>
            <input
              type="number"
              min={500}
              max={240000}
              step={100}
              value={draft.humanDelayMaxMs}
              onChange={(event) => setDraft((prev) => ({ ...prev, humanDelayMaxMs: parseNumber(event.target.value, prev.humanDelayMaxMs) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Typing min (ms)</span>
            <input
              type="number"
              min={200}
              max={60000}
              step={50}
              value={draft.humanTypingMinMs}
              onChange={(event) => setDraft((prev) => ({ ...prev, humanTypingMinMs: parseNumber(event.target.value, prev.humanTypingMinMs) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Typing max (ms)</span>
            <input
              type="number"
              min={200}
              max={120000}
              step={50}
              value={draft.humanTypingMaxMs}
              onChange={(event) => setDraft((prev) => ({ ...prev, humanTypingMaxMs: parseNumber(event.target.value, prev.humanTypingMaxMs) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Outbox claim limit</span>
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              value={draft.outboxClaimLimit}
              onChange={(event) => setDraft((prev) => ({ ...prev, outboxClaimLimit: parseNumber(event.target.value, prev.outboxClaimLimit) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Outbox poll interval (ms)</span>
            <input
              type="number"
              min={500}
              max={60000}
              step={100}
              value={draft.outboxPollMs}
              onChange={(event) => setDraft((prev) => ({ ...prev, outboxPollMs: parseNumber(event.target.value, prev.outboxPollMs) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Inbound merge window (ms)</span>
            <input
              type="number"
              min={2000}
              max={180000}
              step={500}
              value={draft.inboundMergeWindowMs}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, inboundMergeWindowMs: parseNumber(event.target.value, prev.inboundMergeWindowMs) }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
            <span className="queue-meta">
              New inbound messages in the same chat within this window update the pending unsent reply instead of creating another one.
            </span>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Manual interruption cooldown (ms)</span>
            <input
              type="number"
              min={0}
              max={7200000}
              step={1000}
              value={draft.manualInterventionCooldownMs}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  manualInterventionCooldownMs: parseNumber(event.target.value, prev.manualInterventionCooldownMs),
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
            <span className="queue-meta">
              After you manually reply in WhatsApp, auto-replies stay paused for this long in that chat.
            </span>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Quiet hours</span>
            <select
              value={draft.quietHoursEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  quietHoursEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="false">Disabled</option>
              <option value="true">Enabled</option>
            </select>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Quiet start hour (0-23)</span>
            <input
              type="number"
              min={0}
              max={23}
              step={1}
              value={draft.quietHoursStartHour}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, quietHoursStartHour: parseNumber(event.target.value, prev.quietHoursStartHour) }))
              }
              disabled={record.pending || !draft.quietHoursEnabled}
              aria-disabled={record.pending || !draft.quietHoursEnabled}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Quiet end hour (0-23)</span>
            <input
              type="number"
              min={0}
              max={23}
              step={1}
              value={draft.quietHoursEndHour}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, quietHoursEndHour: parseNumber(event.target.value, prev.quietHoursEndHour) }))
              }
              disabled={record.pending || !draft.quietHoursEnabled}
              aria-disabled={record.pending || !draft.quietHoursEnabled}
            />
            <span className="queue-meta">Server-local time window where sends are deferred.</span>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Rate window (minutes)</span>
            <input
              type="number"
              min={5}
              max={1440}
              step={1}
              value={draft.sendRateWindowMinutes}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, sendRateWindowMinutes: parseNumber(event.target.value, prev.sendRateWindowMinutes) }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Max sends per thread in window</span>
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={draft.sendMaxPerThreadInWindow}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, sendMaxPerThreadInWindow: parseNumber(event.target.value, prev.sendMaxPerThreadInWindow) }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Max global sends in window</span>
            <input
              type="number"
              min={1}
              max={1000}
              step={1}
              value={draft.sendMaxGlobalInWindow}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, sendMaxGlobalInWindow: parseNumber(event.target.value, prev.sendMaxGlobalInWindow) }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <p className="queue-meta">
            Worker picks up these values live for generation and queue claims. Poll interval is read at worker start, so restart worker after changing it.
          </p>

          {record.error ? (
            <p className="queue-meta action-inline-error" role="alert">
              {record.error}
            </p>
          ) : null}
        </div>
      </article>

      <article className="panel-card">
        <h3>Proactive Outreach</h3>
        <div className="stack compact">
          <label className="stack compact">
            <span className="queue-meta">Enable proactive check-ins</span>
            <select
              value={draft.outreachEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  outreachEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Cadence (hours between check-ins per contact)</span>
            <input
              type="number"
              min={6}
              max={336}
              step={1}
              value={draft.outreachCadenceHours}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  outreachCadenceHours: parseNumber(event.target.value, prev.outreachCadenceHours),
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Max contacts per run</span>
            <input
              type="number"
              min={1}
              max={25}
              step={1}
              value={draft.outreachMaxContactsPerRun}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  outreachMaxContactsPerRun: parseNumber(event.target.value, prev.outreachMaxContactsPerRun),
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Predefined contacts (one WhatsApp JID per line)</span>
            <select
              value=""
              onChange={(event) => {
                if (!event.target.value) {
                  return;
                }
                addOutreachContact(event.target.value);
              }}
              disabled={record.pending || contactsLoading}
              aria-disabled={record.pending || contactsLoading}
            >
              <option value="">{contactsLoading ? "Loading previous contacts..." : "Add from previous contacts"}</option>
              {knownContacts.map((contact) => (
                <option key={contact._id} value={contact.jid}>
                  {contact.title ? `${contact.title} (${contact.jid})` : contact.jid}
                </option>
              ))}
            </select>
            <textarea
              rows={6}
              placeholder={"2348012345678@s.whatsapp.net\n2348098765432@s.whatsapp.net"}
              value={draft.outreachContactJids.join("\n")}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  outreachContactJids: parseContactJids(event.target.value),
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
            {draft.outreachContactJids.length > 0 ? (
              <div className="stack compact">
                {draft.outreachContactJids.map((jid) => (
                  <div key={jid} className="queue-item">
                    <p className="queue-body">{jid}</p>
                    <div className="queue-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => removeOutreachContact(jid)}
                        disabled={record.pending}
                        aria-disabled={record.pending}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </label>

          <label className="stack compact">
            <span className="queue-meta">Starter template</span>
            <textarea
              rows={3}
              value={draft.outreachStarterTemplate}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  outreachStarterTemplate: event.target.value,
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
            <span className="queue-meta">Use {"{{name}}"} for contact name and optional {"{{icebreaker}}"} placeholder.</span>
          </label>
        </div>
      </article>
    </section>
  );
}
