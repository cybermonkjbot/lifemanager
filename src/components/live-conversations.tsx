"use client";

import { ActionNotices } from "@/components/action-notices";
import { UIModal } from "@/components/ui-modal";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { formatDateTime, trim } from "@/lib/format";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

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

type PersonalityProfileVersion = {
  _id: string;
  profileSlug: string;
  versionNumber: number;
  name: string;
  description: string;
  prompt: string;
  defaultIntensity: number;
  reason?: string;
  createdAt: number;
};

type ThreadPersonalitySetting = {
  profileSlug: string;
  intensity: number;
  customPrompt?: string;
  threadPromptProfile?: string;
  threadPromptProfileSource?: "manual" | "auto";
  threadPromptProfileLookbackDays?: number;
  threadPromptProfileMessageCount?: number;
  threadPromptProfileUpdatedAt?: number;
};

type ThreadPersonalityFormProps = {
  profiles: PersonalityProfile[];
  initialProfileSlug: string;
  initialIntensity: number;
  initialCustomPrompt: string;
  pending: boolean;
  onSave: (values: { profileSlug: string; intensity: number; customPrompt: string }) => void;
};

type PromptProfileFormProps = {
  initialPromptProfile: string;
  initialLookbackDays: number;
  source?: "manual" | "auto";
  messageCount?: number;
  updatedAt?: number;
  pending: boolean;
  onAutoBuild: (lookbackDays: number) => void;
  onSaveManual: (promptProfile: string) => void;
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

type GroundingFormProps = {
  initialMyName: string;
  initialTheirName: string;
  initialVibeNotes: string;
  autoAliases: string[];
  pending: boolean;
  onSave: (values: { myName: string; theirName: string; vibeNotes: string }) => void;
};

type ThreadGrounding = {
  myName?: string;
  theirName?: string;
  autoAliases: string[];
  vibeNotes?: string;
};

type MediaAsset = {
  _id: string;
  kind: "sticker" | "meme";
  label: string;
  tags: string[];
  enabled: boolean;
  mimeType: string;
  fileUrl?: string | null;
};

type MessageMediaPreview = {
  assetId: string;
  kind: "sticker" | "meme";
  mimeType: string;
  label: string;
  url: string | null;
};

type ThreadMessage = {
  _id: string;
  direction: "inbound" | "outbound";
  text: string;
  messageType?: "text" | "reaction" | "sticker" | "meme";
  reactionEmoji?: string;
  reactionTargetWhatsAppMessageId?: string;
  mediaAssetId?: string;
  mediaCaption?: string;
  mediaPreview?: MessageMediaPreview | null;
  messageAt: number;
};

function messageKindLabel(kind?: string) {
  if (kind === "reaction") {
    return "Reaction";
  }
  if (kind === "sticker") {
    return "Sticker";
  }
  if (kind === "meme") {
    return "Meme";
  }
  return "Text";
}

function messageDisplayText(message: {
  text: string;
  messageType?: "text" | "reaction" | "sticker" | "meme";
  reactionEmoji?: string;
}) {
  const normalized = message.text.trim();
  if (normalized) {
    return normalized;
  }
  if (message.messageType === "reaction") {
    return message.reactionEmoji ? `Reacted with ${message.reactionEmoji}` : "Sent a reaction";
  }
  if (message.messageType === "sticker") {
    return "Sent a sticker";
  }
  if (message.messageType === "meme") {
    return "Sent a meme";
  }
  return "Sent a message";
}

function renderMessageMediaPreview(message: ThreadMessage) {
  const preview = message.mediaPreview;
  if (!preview?.url) {
    return message.mediaAssetId ? <p className="queue-meta">Media preview unavailable.</p> : null;
  }

  const mimeType = preview.mimeType.toLowerCase();
  const altText = preview.label || (preview.kind === "meme" ? "Meme" : "Sticker");
  if (mimeType.startsWith("image/") || preview.kind === "meme" || preview.kind === "sticker") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={preview.url} alt={altText} className="message-media-image" loading="lazy" />;
  }
  if (mimeType.startsWith("video/")) {
    return <video src={preview.url} controls preload="metadata" className="message-media-video" />;
  }
  if (mimeType.startsWith("audio/")) {
    return <audio src={preview.url} controls preload="none" className="message-media-audio" />;
  }

  return (
    <a href={preview.url} target="_blank" rel="noreferrer" className="message-media-link">
      Open media attachment
    </a>
  );
}

function parseTagInput(input: string) {
  const tags = input
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(tags)].slice(0, 20);
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0.7;
  }
  return Math.max(0, Math.min(value, 1));
}

function clampLookbackDays(value: number) {
  if (!Number.isFinite(value)) {
    return 365;
  }
  return Math.round(Math.max(7, Math.min(value, 365)));
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

function PromptProfileForm({
  initialPromptProfile,
  initialLookbackDays,
  source,
  messageCount,
  updatedAt,
  pending,
  onAutoBuild,
  onSaveManual,
}: PromptProfileFormProps) {
  const [promptProfile, setPromptProfile] = useState(initialPromptProfile);
  const [lookbackDays, setLookbackDays] = useState(clampLookbackDays(initialLookbackDays));

  const promptChanged = useMemo(() => promptProfile.trim() !== initialPromptProfile.trim(), [initialPromptProfile, promptProfile]);
  const normalizedLookback = clampLookbackDays(lookbackDays);

  return (
    <div className="personality-config-block">
      <h3>Prompt Profile Builder</h3>
      <p className="queue-meta">Auto-build this conversation profile from up to 1 year of history, then edit manually if needed.</p>

      <label className="setup-input-group">
        <span className="queue-meta">Auto-build lookback window (days)</span>
        <input
          type="number"
          min={7}
          max={365}
          step={1}
          value={lookbackDays}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (!Number.isFinite(parsed)) {
              setLookbackDays(365);
              return;
            }
            setLookbackDays(parsed);
          }}
          disabled={pending}
          aria-disabled={pending}
        />
      </label>

      <button
        type="button"
        className="btn btn-primary"
        onClick={() => onAutoBuild(normalizedLookback)}
        disabled={pending}
        aria-disabled={pending}
      >
        {pending ? "Building..." : `Auto-Build From ${normalizedLookback} Days`}
      </button>

      <label className="setup-input-group">
        <span className="queue-meta">Conversation prompt profile</span>
        <textarea
          rows={8}
          value={promptProfile}
          onChange={(event) => setPromptProfile(event.target.value)}
          placeholder="Example: Keep this chat casual and playful, use short replies, and mirror their emoji style."
          disabled={pending}
          aria-disabled={pending}
        />
      </label>

      <div className="queue-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onSaveManual(promptProfile)}
          disabled={pending || !promptChanged}
          aria-disabled={pending || !promptChanged}
        >
          {pending ? "Saving..." : "Save Manual Edit"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => onSaveManual("")}
          disabled={pending || !promptProfile.trim()}
          aria-disabled={pending || !promptProfile.trim()}
        >
          Clear Profile
        </button>
      </div>

      <p className="queue-meta">
        Source: {source || "none"} {typeof messageCount === "number" ? `· ${messageCount} messages` : ""}
        {typeof updatedAt === "number" && updatedAt > 0 ? ` · Updated ${formatDateTime(updatedAt)}` : ""}
      </p>
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

function GroundingForm({ initialMyName, initialTheirName, initialVibeNotes, autoAliases, pending, onSave }: GroundingFormProps) {
  const [myName, setMyName] = useState(initialMyName);
  const [theirName, setTheirName] = useState(initialTheirName);
  const [vibeNotes, setVibeNotes] = useState(initialVibeNotes);

  const hasChanged = useMemo(() => {
    return myName.trim() !== initialMyName.trim() || theirName.trim() !== initialTheirName.trim() || vibeNotes.trim() !== initialVibeNotes.trim();
  }, [initialMyName, initialTheirName, initialVibeNotes, myName, theirName, vibeNotes]);

  return (
    <div className="personality-config-block">
      <h3>Conversation Grounding</h3>
      <p className="queue-meta">Set preferred names and vibe notes for better nickname and tone grounding.</p>
      <label className="setup-input-group">
        <span className="queue-meta">My name in this conversation</span>
        <input type="text" value={myName} onChange={(event) => setMyName(event.target.value)} disabled={pending} aria-disabled={pending} />
      </label>
      <label className="setup-input-group">
        <span className="queue-meta">Their preferred name</span>
        <input type="text" value={theirName} onChange={(event) => setTheirName(event.target.value)} disabled={pending} aria-disabled={pending} />
      </label>
      <label className="setup-input-group">
        <span className="queue-meta">Vibe notes</span>
        <textarea rows={2} value={vibeNotes} onChange={(event) => setVibeNotes(event.target.value)} disabled={pending} aria-disabled={pending} />
      </label>
      <p className="queue-meta">Auto aliases: {autoAliases.join(", ") || "None yet"}</p>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => onSave({ myName, theirName, vibeNotes })}
        disabled={pending || !hasChanged}
        aria-disabled={pending || !hasChanged}
      >
        {pending ? "Saving..." : "Save Grounding"}
      </button>
    </div>
  );
}

function ConversationsContent({ initialThreadId }: { initialThreadId?: string }) {
  const [threadLimit, setThreadLimit] = useState(80);
  const [threadSearch, setThreadSearch] = useState("");
  const threads = useQuery(api.threads.list, { limit: threadLimit }) as
    | Array<{
        _id: string;
        title?: string;
        jid: string;
        threadKind?: "direct" | "group" | "broadcast_or_system";
        isArchived?: boolean;
        lastMessageAt: number;
        latestDraft?: { text?: string } | null;
      }>
    | undefined;
  const threadsLoading = threads === undefined;
  const normalizedThreadSearch = threadSearch.trim().toLowerCase();
  const threadList = (threads || []).filter((thread) => {
    if (!normalizedThreadSearch) {
      return true;
    }
    const haystack = `${thread.title || ""}\n${thread.jid}`.toLowerCase();
    return haystack.includes(normalizedThreadSearch);
  });

  const profilesQuery = useQuery(api.personality.listProfiles, {}) as PersonalityProfile[] | undefined;
  const profilesLoading = profilesQuery === undefined;
  const profiles = profilesQuery || [];
  const setThreadPersonality = useMutation(api.personality.setThreadSetting);
  const setThreadPromptProfile = useMutation(api.personality.setThreadPromptProfile);
  const autoBuildThreadPromptProfile = useMutation(api.personality.autoBuildThreadPromptProfile);
  const upsertPersonalityProfile = useMutation(api.personality.upsertProfile);
  const deletePersonalityProfile = useMutation(api.personality.deleteProfile);
  const rollbackProfileVersion = useMutation(api.personality.rollbackProfileVersion);
  const saveGroundingMutation = useMutation(api.grounding.saveThreadGrounding);
  const ignoreThreadMutation = useMutation(api.backlog.ignoreThread);
  const generateUploadUrl = useMutation(api.media.generateUploadUrl);
  const registerAsset = useMutation(api.media.registerAsset);
  const toggleAsset = useMutation(api.media.toggleAsset);
  const deleteAsset = useMutation(api.media.deleteAsset);
  const recordEvent = useMutation(api.system.recordEvent);
  const { runAction, getRecord, notices, dismissNotice } = useActionStateRegistry();

  const selectedThreadId =
    (initialThreadId && threadList.some((thread) => thread._id === initialThreadId) ? initialThreadId : undefined) || threadList[0]?._id;
  const thread = useQuery(
    api.threads.get,
    selectedThreadId ? { threadId: selectedThreadId as Id<"threads"> } : "skip",
  ) as
    | {
        thread: {
          title?: string;
          jid: string;
          threadKind?: "direct" | "group" | "broadcast_or_system";
          isArchived?: boolean;
          isIgnored?: boolean;
        };
        messages: ThreadMessage[];
        reactions: Array<{
          messageId: string;
          actorJid: string;
          emoji: string;
          direction: "inbound" | "outbound";
        }>;
        grounding?: ThreadGrounding | null;
      }
    | null
    | undefined;

  const threadPersonality = useQuery(
    api.personality.getThreadSetting,
    selectedThreadId ? { threadId: selectedThreadId as Id<"threads"> } : "skip",
  ) as ThreadPersonalitySetting | null | undefined;
  const threadLoading = Boolean(selectedThreadId) && thread === undefined;
  const threadMissing = Boolean(selectedThreadId) && thread === null;
  const threadPersonalityLoading = Boolean(selectedThreadId) && threadPersonality === undefined;
  const threadGrounding = useQuery(
    api.grounding.getThreadGrounding,
    selectedThreadId ? { threadId: selectedThreadId as Id<"threads"> } : "skip",
  ) as ThreadGrounding | null | undefined;
  const mediaAssets = useQuery(api.media.listAssets, {}) as MediaAsset[] | undefined;

  const [editorSlug, setEditorSlug] = useState("");
  const [assetKind, setAssetKind] = useState<"sticker" | "meme">("sticker");
  const [assetLabel, setAssetLabel] = useState("");
  const [assetTags, setAssetTags] = useState("");
  const [assetFile, setAssetFile] = useState<File | null>(null);
  const [newProfileSlug, setNewProfileSlug] = useState("");
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileDescription, setNewProfileDescription] = useState("");
  const [newProfilePrompt, setNewProfilePrompt] = useState("");
  const [newProfileIntensity, setNewProfileIntensity] = useState(0.65);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const selectedEditorSlug = editorSlug || profiles[0]?.slug || "";
  const selectedEditorProfile = profiles.find((profile) => profile.slug === selectedEditorSlug) || null;
  const profileVersions = useQuery(
    api.personality.listProfileVersions,
    selectedEditorProfile ? { slug: selectedEditorProfile.slug, limit: 20 } : "skip",
  ) as PersonalityProfileVersion[] | undefined;

  const settingsKey = selectedThreadId ? `personality:thread:${selectedThreadId}` : "personality:thread:none";
  const promptProfileKey = selectedThreadId ? `personality:promptprofile:${selectedThreadId}` : "personality:promptprofile:none";
  const profileKey = "personality:profile";
  const groundingKey = selectedThreadId ? `grounding:thread:${selectedThreadId}` : "grounding:thread:none";
  const ignoreThreadKey = selectedThreadId ? `conversation:ignore:${selectedThreadId}` : "conversation:ignore:none";
  const mediaKey = "media:library";

  const settingsRecord = getRecord(settingsKey);
  const promptProfileRecord = getRecord(promptProfileKey);
  const profileRecord = getRecord(profileKey);
  const groundingRecord = getRecord(groundingKey);
  const ignoreThreadRecord = getRecord(ignoreThreadKey);
  const mediaRecord = getRecord(mediaKey);
  const lastLoadStartedThreadRef = useRef<string | null>(null);
  const lastLoadedThreadRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedThreadId || lastLoadStartedThreadRef.current === selectedThreadId) {
      return;
    }

    lastLoadStartedThreadRef.current = selectedThreadId;
    void recordEvent({
      source: "dashboard",
      eventType: "conversation.load.start",
      detail: "Loading conversation timeline...",
      threadId: selectedThreadId as Id<"threads">,
    });
  }, [recordEvent, selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId || !thread || lastLoadedThreadRef.current === selectedThreadId) {
      return;
    }

    lastLoadedThreadRef.current = selectedThreadId;
    void recordEvent({
      source: "dashboard",
      eventType: "conversation.load.ready",
      detail: `Conversation loaded (${thread.messages?.length ?? 0} messages).`,
      threadId: selectedThreadId as Id<"threads">,
    });
  }, [recordEvent, selectedThreadId, thread]);

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

  const savePromptProfile = (promptProfile: string) => {
    if (!selectedThreadId) {
      return;
    }

    void runAction(
      promptProfileKey,
      async () => {
        await setThreadPromptProfile({
          threadId: selectedThreadId as Id<"threads">,
          promptProfile,
        });
      },
      {
        pendingLabel: promptProfile.trim() ? "Saving conversation prompt profile..." : "Clearing conversation prompt profile...",
        successMessage: promptProfile.trim()
          ? "Conversation prompt profile saved."
          : "Conversation prompt profile cleared.",
      },
    );
  };

  const autoBuildPromptProfile = (lookbackDays: number) => {
    if (!selectedThreadId) {
      return;
    }

    void runAction(
      promptProfileKey,
      async () => {
        await autoBuildThreadPromptProfile({
          threadId: selectedThreadId as Id<"threads">,
          lookbackDays: clampLookbackDays(lookbackDays),
        });
      },
      {
        pendingLabel: "Building prompt profile from conversation history...",
        successMessage: "Conversation prompt profile auto-built.",
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

  const createProfile = () => {
    const slug = newProfileSlug.trim();
    const name = newProfileName.trim();
    const description = newProfileDescription.trim();
    const prompt = newProfilePrompt.trim();
    if (!slug || !name || !prompt) {
      return;
    }

    void runAction(
      profileKey,
      async () => {
        await upsertPersonalityProfile({
          slug,
          name,
          description: description || "Custom profile",
          prompt,
          defaultIntensity: clamp01(newProfileIntensity),
        });
        setNewProfileSlug("");
        setNewProfileName("");
        setNewProfileDescription("");
        setNewProfilePrompt("");
        setNewProfileIntensity(0.65);
      },
      {
        pendingLabel: "Creating profile...",
        successMessage: "Profile created.",
      },
    );
  };

  const removeProfile = (slug: string) => {
    void runAction(
      profileKey,
      async () => {
        await deletePersonalityProfile({ slug });
      },
      {
        pendingLabel: "Deleting profile...",
        successMessage: "Profile deleted.",
      },
    );
  };

  const rollbackProfile = (versionId: string) => {
    if (!selectedEditorProfile) {
      return;
    }
    void runAction(
      profileKey,
      async () => {
        await rollbackProfileVersion({
          slug: selectedEditorProfile.slug,
          versionId: versionId as Id<"personalityProfileVersions">,
        });
      },
      {
        pendingLabel: "Rolling back profile...",
        successMessage: "Profile rolled back.",
      },
    );
  };

  const saveGrounding = (values: { myName: string; theirName: string; vibeNotes: string }) => {
    if (!selectedThreadId) {
      return;
    }
    void runAction(
      groundingKey,
      async () => {
        await saveGroundingMutation({
          threadId: selectedThreadId as Id<"threads">,
          myName: values.myName.trim() || undefined,
          theirName: values.theirName.trim() || undefined,
          vibeNotes: values.vibeNotes.trim() || undefined,
        });
      },
      {
        pendingLabel: "Saving grounding...",
        successMessage: "Conversation grounding updated.",
      },
    );
  };

  const toggleIgnoreFromConversation = () => {
    if (!selectedThreadId || !thread) {
      return;
    }
    const enableIgnore = !Boolean(thread.thread.isIgnored);
    void runAction(
      ignoreThreadKey,
      async () => {
        await ignoreThreadMutation({
          threadId: selectedThreadId as Id<"threads">,
          enabled: enableIgnore,
        });
      },
      {
        pendingLabel: enableIgnore ? "Disabling auto-respond..." : "Enabling auto-respond...",
        successMessage: enableIgnore ? "Conversation set to do-not-auto-respond." : "Conversation restored for auto-respond.",
      },
    );
  };

  const uploadAsset = () => {
    if (!assetFile) {
      return;
    }

    void runAction(
      mediaKey,
      async () => {
        const uploadUrl = await generateUploadUrl({});
        const upload = await fetch(uploadUrl as string, {
          method: "POST",
          headers: {
            "Content-Type": assetFile.type || "application/octet-stream",
          },
          body: assetFile,
        });

        if (!upload.ok) {
          throw new Error(`Upload failed (${upload.status})`);
        }

        const payload = (await upload.json()) as { storageId?: string };
        if (!payload.storageId) {
          throw new Error("Upload response missing storageId.");
        }

        await registerAsset({
          kind: assetKind,
          label: assetLabel.trim() || assetFile.name,
          tags: parseTagInput(assetTags),
          fileId: payload.storageId as Id<"_storage">,
          mimeType: assetFile.type || "application/octet-stream",
          enabled: true,
        });

        setAssetFile(null);
        setAssetLabel("");
        setAssetTags("");
      },
      {
        pendingLabel: "Uploading media asset...",
        successMessage: "Media asset added.",
      },
    );
  };

  const reactionsByMessage = useMemo(() => {
    const map = new Map<string, Array<{ actorJid: string; emoji: string; direction: "inbound" | "outbound" }>>();
    const rows = thread?.reactions || [];
    for (const row of rows) {
      const list = map.get(row.messageId) || [];
      list.push({
        actorJid: row.actorJid,
        emoji: row.emoji,
        direction: row.direction,
      });
      map.set(row.messageId, list);
    }
    return map;
  }, [thread?.reactions]);

  const threadSettingKey = `${selectedThreadId || "none"}:${threadPersonality?.profileSlug || "casual"}:${threadPersonality?.intensity || 0.6}:${threadPersonality?.customPrompt || ""}`;
  const promptProfileFormKey = `${selectedThreadId || "none"}:${threadPersonality?.threadPromptProfile || ""}:${threadPersonality?.threadPromptProfileLookbackDays || 365}:${threadPersonality?.threadPromptProfileSource || "none"}:${threadPersonality?.threadPromptProfileUpdatedAt || 0}`;
  const editorFormKey = `${selectedEditorProfile?.slug || "none"}:${selectedEditorProfile?.updatedAt || 0}`;

  return (
    <section className="panel-grid split-view">
      <article className="panel-card">
        <h3>Threads</h3>
        <div className="queue-actions">
          <label className="setup-input-group inline">
            <span className="queue-meta">Search</span>
            <input
              type="text"
              value={threadSearch}
              placeholder="Search thread..."
              onChange={(event) => setThreadSearch(event.target.value)}
            />
          </label>
        </div>
        <div className="stack thread-list">
          {threadsLoading ? <p className="empty-line">Loading threads…</p> : null}
          {threadList.map((item) => (
            <Link
              key={item._id}
              href={`/conversations?threadId=${item._id}`}
              className={`thread-row${item._id === selectedThreadId ? " active" : ""}`}
              aria-current={item._id === selectedThreadId ? "page" : undefined}
            >
              <p className="queue-title">{item.title || item.jid}</p>
              <p className="queue-meta">
                {item.threadKind === "broadcast_or_system" ? "Broadcast/System" : item.threadKind === "group" ? "Group" : "Direct"}
                {item.isArchived ? " · Archived" : ""}
              </p>
              <p className="queue-body">{trim(item.latestDraft?.text || "No draft yet")}</p>
              <p className="queue-meta">Last activity: {formatDateTime(item.lastMessageAt)}</p>
            </Link>
          ))}
          {!threadsLoading && threadList.length === 0 ? <p className="empty-line">No threads yet.</p> : null}
          {!threadsLoading ? (
            <div className="thread-list-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setThreadLimit((prev) => Math.min(prev + 80, 500))}>
                Load More
              </button>
            </div>
          ) : null}
        </div>
      </article>

      <article className="panel-card" aria-busy={threadLoading}>
        <ActionNotices notices={notices} onDismiss={dismissNotice} />
        <h3>Timeline</h3>
        <div className="queue-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setSettingsModalOpen(true)}>
            Open Settings
          </button>
        </div>
        {threadLoading ? (
          <p className="empty-line">Loading timeline...</p>
        ) : thread ? (
          <div className="conversation-chat">
            <header className="conversation-chat-header">
              <p className="queue-title">{thread.thread.title || thread.thread.jid}</p>
              <p className="queue-meta">
                {thread.thread.threadKind === "broadcast_or_system"
                  ? "Broadcast/System thread (automation blocked)"
                  : thread.thread.threadKind === "group"
                    ? "Group thread"
                    : "Direct thread"}
                {thread.thread.isArchived ? " · Archived (read-only automation)" : ""}
              </p>
              <p className="queue-meta">{thread.thread.jid}</p>
              <p className="queue-meta">
                Auto-respond: {thread.thread.isIgnored ? "Disabled (ignored)" : "Enabled"}
              </p>
              <div className="queue-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={toggleIgnoreFromConversation}
                  disabled={ignoreThreadRecord.pending}
                  aria-disabled={ignoreThreadRecord.pending}
                >
                  {ignoreThreadRecord.pending
                    ? thread.thread.isIgnored
                      ? "Enabling..."
                      : "Disabling..."
                    : thread.thread.isIgnored
                      ? "Allow Auto-Respond"
                      : "Do Not Auto-Respond"}
                </button>
              </div>
              {ignoreThreadRecord.error ? (
                <p className="queue-meta action-inline-error" role="alert">
                  {ignoreThreadRecord.error}
                </p>
              ) : null}
            </header>
            <div className="conversation-chat-window" role="log" aria-live="polite">
              {(thread.messages || []).length === 0 ? (
                <p className="empty-line">No messages in this thread yet.</p>
              ) : null}
              {(thread.messages || []).map((message) => {
                const outbound = message.direction === "outbound";
                const senderName = outbound
                  ? threadGrounding?.myName?.trim() || "You"
                  : threadGrounding?.theirName?.trim() || thread.thread.title || "Contact";
                const senderBadge = senderName.charAt(0).toUpperCase();
                const displayText = messageDisplayText(message);
                const mediaCaption = message.mediaCaption?.trim();
                const showMediaCaption = Boolean(mediaCaption && mediaCaption !== displayText);

                return (
                  <div key={message._id} className={`chat-row ${outbound ? "outbound" : "inbound"}`}>
                    <span className={`chat-avatar ${outbound ? "outbound" : "inbound"}`} aria-hidden="true">
                      {senderBadge || (outbound ? "Y" : "C")}
                    </span>
                    <div className={`message-bubble ${outbound ? "outbound" : "inbound"}`}>
                      <p className="message-sender">{senderName}</p>
                      <p className="message-text">{displayText}</p>
                      {renderMessageMediaPreview(message)}
                      {showMediaCaption ? <p className="message-media-caption">{mediaCaption}</p> : null}
                      <p className="queue-meta">{messageKindLabel(message.messageType)}</p>
                      {(reactionsByMessage.get(message._id) || []).length > 0 ? (
                        <div className="queue-actions">
                          {(reactionsByMessage.get(message._id) || []).map((reaction, index) => (
                            <span key={`${reaction.actorJid}:${index}`} className="queue-meta">
                              {reaction.emoji} {reaction.direction === "outbound" ? "me" : "them"}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <span>{formatDateTime(message.messageAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : threadMissing ? (
          <p className="empty-line">This thread is no longer available.</p>
        ) : (
          <p className="empty-line">{threadsLoading ? "Loading threads..." : "Choose a thread from the left."}</p>
        )}

        <UIModal
          open={settingsModalOpen}
          onClose={() => setSettingsModalOpen(false)}
          title={selectedThreadId ? "Conversation Settings" : "Workspace Settings"}
          description="Manage conversation personality, grounding, profile studio, and media assets."
        >
          <div className="conversation-controls">
            {selectedThreadId && (threadPersonalityLoading || profilesLoading) ? (
              <p className="empty-line">Loading personality settings…</p>
            ) : null}

            {selectedThreadId && !threadLoading && !threadMissing && !threadPersonalityLoading && profiles.length > 0 ? (
              <ThreadPersonalityForm
                key={threadSettingKey}
                profiles={profiles}
                initialProfileSlug={threadPersonality?.profileSlug || "casual"}
                initialIntensity={threadPersonality?.intensity ?? 0.6}
                initialCustomPrompt={threadPersonality?.customPrompt || ""}
                pending={settingsRecord.pending}
                onSave={saveThreadSetting}
              />
            ) : null}

            {selectedThreadId && !threadLoading && !threadMissing && !threadPersonalityLoading ? (
              <PromptProfileForm
                key={promptProfileFormKey}
                initialPromptProfile={threadPersonality?.threadPromptProfile || ""}
                initialLookbackDays={threadPersonality?.threadPromptProfileLookbackDays || 365}
                source={threadPersonality?.threadPromptProfileSource}
                messageCount={threadPersonality?.threadPromptProfileMessageCount}
                updatedAt={threadPersonality?.threadPromptProfileUpdatedAt}
                pending={promptProfileRecord.pending}
                onAutoBuild={autoBuildPromptProfile}
                onSaveManual={savePromptProfile}
              />
            ) : null}

            {selectedThreadId && !threadLoading && !threadMissing ? (
              <GroundingForm
                key={`${selectedThreadId}:${threadGrounding?.myName || ""}:${threadGrounding?.theirName || ""}:${threadGrounding?.vibeNotes || ""}`}
                initialMyName={threadGrounding?.myName || ""}
                initialTheirName={threadGrounding?.theirName || ""}
                initialVibeNotes={threadGrounding?.vibeNotes || ""}
                autoAliases={threadGrounding?.autoAliases || []}
                pending={groundingRecord.pending}
                onSave={saveGrounding}
              />
            ) : null}

            {profilesLoading ? <p className="empty-line">Loading personality profiles…</p> : null}

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

                {selectedEditorProfile && !selectedEditorProfile.isDefault ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => removeProfile(selectedEditorProfile.slug)}
                    disabled={profileRecord.pending}
                    aria-disabled={profileRecord.pending}
                  >
                    Delete Profile
                  </button>
                ) : null}

                <div className="personality-config-block">
                  <h3>Create Profile</h3>
                  <label className="setup-input-group">
                    <span className="queue-meta">Slug</span>
                    <input value={newProfileSlug} onChange={(event) => setNewProfileSlug(event.target.value)} placeholder="family_warm" />
                  </label>
                  <label className="setup-input-group">
                    <span className="queue-meta">Name</span>
                    <input value={newProfileName} onChange={(event) => setNewProfileName(event.target.value)} placeholder="Family Warm" />
                  </label>
                  <label className="setup-input-group">
                    <span className="queue-meta">Description</span>
                    <input value={newProfileDescription} onChange={(event) => setNewProfileDescription(event.target.value)} placeholder="Gentle and caring." />
                  </label>
                  <label className="setup-input-group">
                    <span className="queue-meta">Prompt</span>
                    <textarea rows={3} value={newProfilePrompt} onChange={(event) => setNewProfilePrompt(event.target.value)} />
                  </label>
                  <label className="setup-input-group">
                    <span className="queue-meta">Default Intensity: {Math.round(newProfileIntensity * 100)}%</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={newProfileIntensity}
                      onChange={(event) => setNewProfileIntensity(Number(event.target.value))}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={createProfile}
                    disabled={profileRecord.pending || !newProfileSlug.trim() || !newProfileName.trim() || !newProfilePrompt.trim()}
                    aria-disabled={profileRecord.pending || !newProfileSlug.trim() || !newProfileName.trim() || !newProfilePrompt.trim()}
                  >
                    Create Profile
                  </button>
                </div>

                <div className="personality-config-block">
                  <h3>Profile Version History</h3>
                  <div className="stack">
                    {(profileVersions || []).map((version) => (
                      <div key={version._id} className="queue-item">
                        <p className="queue-title">
                          v{version.versionNumber} · {version.name}
                        </p>
                        <p className="queue-meta">
                          {version.reason || "snapshot"} · {formatDateTime(version.createdAt)}
                        </p>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => rollbackProfile(version._id)}
                          disabled={profileRecord.pending}
                          aria-disabled={profileRecord.pending}
                        >
                          Rollback to This
                        </button>
                      </div>
                    ))}
                    {profileVersions !== undefined && profileVersions.length === 0 ? (
                      <p className="empty-line">No history entries yet.</p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : !profilesLoading ? (
              <p className="empty-line">No personality profiles configured yet.</p>
            ) : null}

            <div className="personality-config-block">
              <h3>Media Library</h3>
              <p className="queue-meta">Upload curated sticker and meme assets for outbound policy use.</p>
              <label className="setup-input-group">
                <span className="queue-meta">Kind</span>
                <select
                  value={assetKind}
                  onChange={(event) => setAssetKind(event.target.value === "meme" ? "meme" : "sticker")}
                  disabled={mediaRecord.pending}
                  aria-disabled={mediaRecord.pending}
                >
                  <option value="sticker">Sticker</option>
                  <option value="meme">Meme</option>
                </select>
              </label>
              <label className="setup-input-group">
                <span className="queue-meta">Label</span>
                <input
                  type="text"
                  value={assetLabel}
                  onChange={(event) => setAssetLabel(event.target.value)}
                  disabled={mediaRecord.pending}
                  aria-disabled={mediaRecord.pending}
                />
              </label>
              <label className="setup-input-group">
                <span className="queue-meta">Tags (comma separated)</span>
                <input
                  type="text"
                  value={assetTags}
                  onChange={(event) => setAssetTags(event.target.value)}
                  disabled={mediaRecord.pending}
                  aria-disabled={mediaRecord.pending}
                />
              </label>
              <label className="setup-input-group">
                <span className="queue-meta">File</span>
                <input
                  type="file"
                  accept="image/*,.webp"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setAssetFile(event.target.files?.[0] || null)}
                  disabled={mediaRecord.pending}
                  aria-disabled={mediaRecord.pending}
                />
              </label>
              <button
                type="button"
                className="btn btn-primary"
                onClick={uploadAsset}
                disabled={mediaRecord.pending || !assetFile}
                aria-disabled={mediaRecord.pending || !assetFile}
              >
                {mediaRecord.pending ? "Uploading..." : "Upload Asset"}
              </button>
              <div className="stack">
                {(mediaAssets || []).map((asset) => (
                  <div key={asset._id} className="queue-item">
                    <p className="queue-title">
                      {asset.label} ({asset.kind})
                    </p>
                    <p className="queue-meta">
                      {asset.enabled ? "Enabled" : "Disabled"} · {asset.tags.join(", ") || "No tags"}
                    </p>
                    <div className="queue-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() =>
                          void runAction(
                            mediaKey,
                            async () => {
                              await toggleAsset({
                                assetId: asset._id as Id<"mediaAssets">,
                                enabled: !asset.enabled,
                              });
                            },
                            {
                              pendingLabel: "Updating asset...",
                              successMessage: "Asset updated.",
                            },
                          )
                        }
                      >
                        {asset.enabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() =>
                          void runAction(
                            mediaKey,
                            async () => {
                              await deleteAsset({
                                assetId: asset._id as Id<"mediaAssets">,
                              });
                            },
                            {
                              pendingLabel: "Deleting asset...",
                              successMessage: "Asset deleted.",
                            },
                          )
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
                {(mediaAssets || []).length === 0 ? <p className="empty-line">No media assets yet.</p> : null}
              </div>
            </div>
          </div>
        </UIModal>
      </article>
    </section>
  );
}

export function LiveConversations({ initialThreadId }: LiveConversationsProps) {
  return <ConversationsContent initialThreadId={initialThreadId} />;
}
