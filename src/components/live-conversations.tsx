"use client";

import { ActionNotices } from "@/components/action-notices";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { formatDateTime, trim } from "@/lib/format";
import { useMemo, useState } from "react";

type LiveConversationsProps = {
  initialThreadId?: string;
};

type PersonalityProfile = {
  slug: string;
  name: string;
  description: string;
  prompt: string;
  defaultIntensity: number;
  isDefault?: boolean;
  updatedAt?: number;
};

type ThreadPersonalitySetting = {
  profileSlug: string;
  intensity: number;
  customPrompt?: string;
};

type ThreadPersonalityFormProps = {
  profiles: PersonalityProfile[];
  initialProfileSlug: string;
  initialIntensity: number;
  initialCustomPrompt: string;
  pending: boolean;
  onSave: (values: { profileSlug: string; intensity: number; customPrompt: string }) => void;
};

type ProfileEditorFormProps = {
  profile: PersonalityProfile;
  pending: boolean;
  error?: string;
  onSave: (values: {
    slug: string;
    name: string;
    description: string;
    prompt: string;
    defaultIntensity: number;
  }) => void;
};

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0.7;
  }
  return Math.max(0, Math.min(value, 1));
}

function ThreadPersonalityForm({
  profiles,
  initialProfileSlug,
  initialIntensity,
  initialCustomPrompt,
  pending,
  onSave,
}: ThreadPersonalityFormProps) {
  const [profileSlug, setProfileSlug] = useState(initialProfileSlug);
  const [intensity, setIntensity] = useState(clamp01(initialIntensity));
  const [customPrompt, setCustomPrompt] = useState(initialCustomPrompt);

  const hasChanged = useMemo(() => {
    const profileChanged = profileSlug !== initialProfileSlug;
    const intensityChanged = Math.abs(intensity - clamp01(initialIntensity)) >= 0.001;
    const promptChanged = customPrompt.trim() !== initialCustomPrompt.trim();
    return profileChanged || intensityChanged || promptChanged;
  }, [customPrompt, initialCustomPrompt, initialIntensity, initialProfileSlug, intensity, profileSlug]);

  return (
    <div className="personality-config-block">
      <h3>Conversation Personality</h3>
      <p className="queue-meta">Set how replies should sound for this specific conversation.</p>

      <label className="setup-input-group">
        <span className="queue-meta">Profile</span>
        <select
          value={profileSlug}
          onChange={(event) => setProfileSlug(event.target.value)}
          disabled={pending}
          aria-disabled={pending}
        >
          {profiles.map((profile) => (
            <option key={profile.slug} value={profile.slug}>
              {profile.name}
            </option>
          ))}
        </select>
      </label>

      <label className="setup-input-group">
        <span className="queue-meta">Intensity: {Math.round(intensity * 100)}%</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={intensity}
          onChange={(event) => setIntensity(Number(event.target.value))}
          disabled={pending}
          aria-disabled={pending}
        />
      </label>

      <label className="setup-input-group">
        <span className="queue-meta">Thread-specific note (optional)</span>
        <textarea
          rows={3}
          value={customPrompt}
          onChange={(event) => setCustomPrompt(event.target.value)}
          placeholder="Examples: Be extra playful. Use pet names lightly. Keep this one more formal."
          disabled={pending}
          aria-disabled={pending}
        />
      </label>

      <button
        type="button"
        className="btn btn-primary"
        onClick={() => onSave({ profileSlug, intensity, customPrompt })}
        disabled={!hasChanged || pending}
        aria-disabled={!hasChanged || pending}
      >
        {pending ? "Saving..." : "Save Conversation Personality"}
      </button>
    </div>
  );
}

function ProfileEditorForm({ profile, pending, error, onSave }: ProfileEditorFormProps) {
  const [name, setName] = useState(profile.name);
  const [description, setDescription] = useState(profile.description);
  const [prompt, setPrompt] = useState(profile.prompt);
  const [defaultIntensity, setDefaultIntensity] = useState(clamp01(profile.defaultIntensity));

  const hasChanged = useMemo(() => {
    return (
      name.trim() !== profile.name ||
      description.trim() !== profile.description ||
      prompt.trim() !== profile.prompt ||
      Math.abs(defaultIntensity - clamp01(profile.defaultIntensity)) >= 0.001
    );
  }, [defaultIntensity, description, name, profile.defaultIntensity, profile.description, profile.name, profile.prompt, prompt]);

  return (
    <div className="personality-config-block">
      <h3>Personality Profiles</h3>
      <p className="queue-meta">Configure your core modes (girlfriend, relationship, friendship, casual).</p>

      <label className="setup-input-group">
        <span className="queue-meta">Display Name</span>
        <input type="text" value={name} onChange={(event) => setName(event.target.value)} disabled={pending} aria-disabled={pending} />
      </label>

      <label className="setup-input-group">
        <span className="queue-meta">Description</span>
        <input
          type="text"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={pending}
          aria-disabled={pending}
        />
      </label>

      <label className="setup-input-group">
        <span className="queue-meta">Behavior Prompt</span>
        <textarea rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={pending} aria-disabled={pending} />
      </label>

      <label className="setup-input-group">
        <span className="queue-meta">Default Intensity: {Math.round(defaultIntensity * 100)}%</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={defaultIntensity}
          onChange={(event) => setDefaultIntensity(Number(event.target.value))}
          disabled={pending}
          aria-disabled={pending}
        />
      </label>

      <button
        type="button"
        className="btn btn-primary"
        onClick={() =>
          onSave({
            slug: profile.slug,
            name,
            description,
            prompt,
            defaultIntensity,
          })
        }
        disabled={!hasChanged || pending}
        aria-disabled={!hasChanged || pending}
      >
        {pending ? "Saving..." : "Save Profile"}
      </button>

      {error ? (
        <p className="queue-meta action-inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ConversationsContent({ initialThreadId }: { initialThreadId?: string }) {
  const threads = useQuery(api.threads.list, { limit: 50 }) as
    | Array<{
        _id: string;
        title?: string;
        jid: string;
        lastMessageAt: number;
        latestDraft?: { text?: string } | null;
      }>
    | undefined;

  const profiles = (useQuery(api.personality.listProfiles, {}) as PersonalityProfile[] | undefined) || [];
  const setThreadPersonality = useMutation(api.personality.setThreadSetting);
  const upsertPersonalityProfile = useMutation(api.personality.upsertProfile);
  const { runAction, getRecord, notices, dismissNotice } = useActionStateRegistry();

  const selectedThreadId = initialThreadId || threads?.[0]?._id;
  const thread = useQuery(
    api.threads.get,
    selectedThreadId ? { threadId: selectedThreadId as Id<"threads"> } : "skip",
  ) as
    | {
        thread: { title?: string; jid: string };
        messages: Array<{
          _id: string;
          direction: "inbound" | "outbound";
          text: string;
          messageAt: number;
        }>;
      }
    | null
    | undefined;

  const threadPersonality = useQuery(
    api.personality.getThreadSetting,
    selectedThreadId ? { threadId: selectedThreadId as Id<"threads"> } : "skip",
  ) as ThreadPersonalitySetting | null | undefined;

  const [editorSlug, setEditorSlug] = useState("");
  const selectedEditorSlug = editorSlug || profiles[0]?.slug || "";
  const selectedEditorProfile = profiles.find((profile) => profile.slug === selectedEditorSlug) || null;

  const settingsKey = selectedThreadId ? `personality:thread:${selectedThreadId}` : "personality:thread:none";
  const profileKey = "personality:profile";

  const settingsRecord = getRecord(settingsKey);
  const profileRecord = getRecord(profileKey);

  const saveThreadSetting = (values: { profileSlug: string; intensity: number; customPrompt: string }) => {
    if (!selectedThreadId) {
      return;
    }

    void runAction(
      settingsKey,
      async () => {
        await setThreadPersonality({
          threadId: selectedThreadId as Id<"threads">,
          profileSlug: values.profileSlug,
          intensity: clamp01(values.intensity),
          customPrompt: values.customPrompt.trim() || undefined,
        });
      },
      {
        pendingLabel: "Saving conversation personality...",
        successMessage: "Conversation personality updated.",
      },
    );
  };

  const saveProfile = (values: {
    slug: string;
    name: string;
    description: string;
    prompt: string;
    defaultIntensity: number;
  }) => {
    void runAction(
      profileKey,
      async () => {
        await upsertPersonalityProfile({
          slug: values.slug,
          name: values.name.trim(),
          description: values.description.trim(),
          prompt: values.prompt.trim(),
          defaultIntensity: clamp01(values.defaultIntensity),
        });
      },
      {
        pendingLabel: "Saving profile...",
        successMessage: "Personality profile updated.",
      },
    );
  };

  const threadSettingKey = `${selectedThreadId || "none"}:${threadPersonality?.profileSlug || "casual"}:${threadPersonality?.intensity || 0.6}:${threadPersonality?.customPrompt || ""}`;
  const editorFormKey = `${selectedEditorProfile?.slug || "none"}:${selectedEditorProfile?.updatedAt || 0}`;

  return (
    <section className="panel-grid split-view">
      <article className="panel-card">
        <h3>Threads</h3>
        <div className="stack">
          {(threads || []).map((item) => (
            <Link key={item._id} href={`/conversations?threadId=${item._id}`} className="thread-row">
              <p className="queue-title">{item.title || item.jid}</p>
              <p className="queue-body">{trim(item.latestDraft?.text || "No draft yet")}</p>
              <p className="queue-meta">Last activity: {formatDateTime(item.lastMessageAt)}</p>
            </Link>
          ))}
          {(threads || []).length === 0 ? <p className="empty-line">No threads yet.</p> : null}
        </div>
      </article>

      <article className="panel-card" aria-busy={Boolean(selectedThreadId && !thread)}>
        <ActionNotices notices={notices} onDismiss={dismissNotice} />
        <h3>Timeline</h3>
        {thread ? (
          <div className="stack">
            <p className="queue-meta">Thread: {thread.thread.title || thread.thread.jid}</p>
            {(thread.messages || []).map((message) => (
              <div key={message._id} className={`message-bubble ${message.direction === "outbound" ? "outbound" : "inbound"}`}>
                <p>{message.text}</p>
                <span>{formatDateTime(message.messageAt)}</span>
              </div>
            ))}
          </div>
        ) : selectedThreadId ? (
          <p className="empty-line">Loading timeline...</p>
        ) : (
          <p className="empty-line">Choose a thread from the left.</p>
        )}

        {selectedThreadId && threadPersonality && profiles.length > 0 ? (
          <ThreadPersonalityForm
            key={threadSettingKey}
            profiles={profiles}
            initialProfileSlug={threadPersonality.profileSlug || "casual"}
            initialIntensity={threadPersonality.intensity ?? 0.6}
            initialCustomPrompt={threadPersonality.customPrompt || ""}
            pending={settingsRecord.pending}
            onSave={saveThreadSetting}
          />
        ) : null}

        {profiles.length > 0 ? (
          <div className="personality-config-block">
            <h3>Profile Studio</h3>
            <p className="queue-meta">Pick a profile and edit how it behaves across all conversations.</p>
            <label className="setup-input-group">
              <span className="queue-meta">Profile to Edit</span>
              <select value={selectedEditorSlug} onChange={(event) => setEditorSlug(event.target.value)}>
                {profiles.map((profile) => (
                  <option key={profile.slug} value={profile.slug}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>

            {selectedEditorProfile ? (
              <ProfileEditorForm
                key={editorFormKey}
                profile={selectedEditorProfile}
                pending={profileRecord.pending}
                error={profileRecord.error}
                onSave={saveProfile}
              />
            ) : null}
          </div>
        ) : null}
      </article>
    </section>
  );
}

export function LiveConversations({ initialThreadId }: LiveConversationsProps) {
  return <ConversationsContent initialThreadId={initialThreadId} />;
}
