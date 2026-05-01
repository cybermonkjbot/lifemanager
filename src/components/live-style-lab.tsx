"use client";

import { ActionNotices } from "@/components/action-notices";
import { EmptyState } from "@/components/empty-state";
import { LoadingBlock, LoadingIndicator } from "@/components/loading-state";
import { useTenantScopeArgs } from "@/components/tenant-scope-provider";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { computeConversationStyleMatrix } from "../../shared/conversation-style-matrix";
import { useMutation, useQuery } from "convex/react";
import { FormEvent, useEffect, useMemo, useState } from "react";

type LearnedTraitField = "commonPhrases" | "punctuationStyle" | "spellingNotes" | "humorNotes";
type PhraseCleanupResult = {
  dryRun: boolean;
  scannedProfiles: number;
  updatedProfiles: number;
  removedPhraseCount: number;
  isDone: boolean;
};
const MAX_SAFE_MIMICRY_LEVEL = 0.82;

const LEARNED_TRAIT_SECTIONS: Array<{ trait: LearnedTraitField; label: string; emptyLabel: string }> = [
  { trait: "commonPhrases", label: "Common phrases", emptyLabel: "Not enough data yet." },
  { trait: "punctuationStyle", label: "Punctuation style", emptyLabel: "No punctuation profile yet." },
  { trait: "spellingNotes", label: "Spelling style", emptyLabel: "No spelling profile yet." },
  { trait: "humorNotes", label: "Humor markers", emptyLabel: "No humor markers yet." },
];

const STYLE_MATRIX_PREVIEWS = [
  { label: "Family", inboundText: "Mum has been sick and I am worried.", profileSlug: "family" },
  { label: "Grief/support", inboundText: "We lost someone in the family yesterday.", profileSlug: "family" },
  { label: "Conflict repair", inboundText: "That came off harsh and it hurt me.", profileSlug: "relationship" },
  { label: "Group/community", inboundText: "Guys can everyone confirm who is coming?", profileSlug: "community_group", threadKind: "group" },
  { label: "Vendor/service", inboundText: "Please send the receipt for my delivery refund.", profileSlug: "vendor_service" },
  { label: "Mentorship", inboundText: "Can you mentor me and review my career plan?", profileSlug: "mentorship" },
] as const;

function StyleLabContent() {
  const tenantScope = useTenantScopeArgs();
  const setMimicry = useMutation(api.style.setMimicry);
  const rollbackHistory = useMutation(api.style.rollbackHistory);
  const updateLearnedTrait = useMutation(api.style.updateLearnedTrait);
  const removeLearnedTrait = useMutation(api.style.removeLearnedTrait);
  const clearLearnedTraitSection = useMutation(api.style.clearLearnedTraitSection);
  const cleanupCommonPhrases = useMutation(api.style.cleanupCommonPhrases);
  const installPersonaPack = useMutation(api.personality.installPersonaPack);
  const { runAction, getRecord, notices, dismissNotice } = useActionStateRegistry();
  const key = "style:mimicry";
  const [installingPackId, setInstallingPackId] = useState<string | null>(null);

  const profile = useQuery(api.style.getProfile, tenantScope) as
    | {
        mimicryLevel: number;
        commonPhrases: string[];
        punctuationStyle: string[];
        spellingNotes: string[];
        humorNotes: string[];
        learnedEmojiAllowlist?: string[];
        learnedEmojiCategoryHints?: string[];
      }
    | undefined;
  const profileLoading = profile === undefined;
  const history = useQuery(api.style.listHistory, { ...tenantScope, limit: 20 }) as
    | Array<{
        _id: string;
        mimicryLevel: number;
        reason?: string;
        createdAt: number;
      }>
    | undefined;
  const personaPacks = useQuery(api.personality.listPersonaPacks, tenantScope) as
    | {
        activePersonaPackId: string;
        activePersonaPackIdsByProfile?: Record<string, string>;
        qualityGateMode: "auto_rewrite_once" | "manual_review" | "log_only";
        qualityGateThreshold: number;
        packs: Array<{
          id: string;
          name: string;
          version: string;
          description: string;
          allowedProfileSlugs: string[];
          activeForProfileSlugs?: string[];
          isLegacyActive?: boolean;
          cohorts?: string[];
          scenarioCount?: number;
        }>;
      }
    | undefined;
  const historyLoading = history === undefined;

  const currentLevel = profile?.mimicryLevel ?? 0.72;
  const [mimicryLevel, setMimicryLevel] = useState(currentLevel);

  useEffect(() => {
    setMimicryLevel(currentLevel);
  }, [currentLevel]);

  const hasChanged = useMemo(() => {
    return Math.abs(mimicryLevel - currentLevel) >= 0.001;
  }, [mimicryLevel, currentLevel]);

  const record = getRecord(key);
  const rollbackRecord = getRecord("style:rollback");
  const cleanupPreviewRecord = getRecord("style:cleanup:preview");
  const cleanupApplyRecord = getRecord("style:cleanup:apply");
  const installPackRecord = getRecord("style:persona-pack:install");
  const [editingTrait, setEditingTrait] = useState<{ trait: LearnedTraitField; value: string } | null>(null);
  const [traitDraft, setTraitDraft] = useState("");
  const [cleanupSummary, setCleanupSummary] = useState<PhraseCleanupResult | null>(null);
  const [newTraitDrafts, setNewTraitDrafts] = useState<Record<LearnedTraitField, string>>({
    commonPhrases: "",
    punctuationStyle: "",
    spellingNotes: "",
    humorNotes: "",
  });

  const traitsByField = useMemo<Record<LearnedTraitField, string[]>>(
    () => ({
      commonPhrases: profile?.commonPhrases || [],
      punctuationStyle: profile?.punctuationStyle || [],
      spellingNotes: profile?.spellingNotes || [],
      humorNotes: profile?.humorNotes || [],
    }),
    [profile],
  );

  const previewNeutral = useMemo(() => {
    if (mimicryLevel <= 0.3) {
      return "Thanks for the update. I appreciate it.";
    }
    if (mimicryLevel <= 0.65) {
      return "Thanks for the update, got it. I appreciate you sharing.";
    }
    if (mimicryLevel <= 0.85) {
      return "Haha thanks for the update, got you. Appreciate you sharing this.";
    }
    return "Haha got you, thanks for the update. Really appreciate you sharing this with me.";
  }, [mimicryLevel]);

  const previewPlayful = useMemo(() => {
    if (mimicryLevel <= 0.3) {
      return "Sounds good. I can handle that.";
    }
    if (mimicryLevel <= 0.65) {
      return "Sounds good, I can handle that. Give me a little time.";
    }
    if (mimicryLevel <= 0.85) {
      return "Sounds good haha, I can handle that. Give me a little time and I’ll update you.";
    }
    return "Sounds good haha, I can handle that for sure. Give me a little time and I’ll update you asap.";
  }, [mimicryLevel]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hasChanged) {
      return;
    }

    void runAction(
      key,
      async () => {
        await setMimicry({ ...tenantScope, mimicryLevel });
      },
      {
        pendingLabel: "Saving...",
        successMessage: "Mimicry level updated.",
      },
    );
  };

  return (
    <section className="style-settings-flow">
      <article className="panel-card style-mimicry-panel">
        <ActionNotices notices={notices} onDismiss={dismissNotice} />
        <div className="style-section-head">
          <div>
            <p className="settings-eyebrow">Voice matching</p>
            <h3>Mimicry Control</h3>
            <p className="queue-meta">Tune how closely replies borrow pacing, warmth, and casual markers from the learned style profile.</p>
          </div>
          <div className="style-stat-strip" aria-label="Mimicry values">
            <div>
              <span>Current</span>
              <strong>{profileLoading ? "--" : `${Math.round(currentLevel * 100)}%`}</strong>
            </div>
            <div>
              <span>Draft</span>
              <strong>{Math.round(mimicryLevel * 100)}%</strong>
            </div>
            <div>
              <span>Cap</span>
              <strong>{Math.round(MAX_SAFE_MIMICRY_LEVEL * 100)}%</strong>
            </div>
          </div>
        </div>
        {profileLoading ? <LoadingIndicator label="Loading style profile..." /> : null}
        <form onSubmit={onSubmit} className="stack compact" aria-busy={record.pending}>
          <div className="style-range-control">
            <label htmlFor="mimicry-level">
              <span className="queue-title">Mimicry level</span>
              <span className="queue-meta">Higher values sound more familiar while staying below the safety cap.</span>
            </label>
            <input
              id="mimicry-level"
              type="range"
              min="0"
              max={MAX_SAFE_MIMICRY_LEVEL}
              step="0.01"
              name="mimicryLevel"
              value={mimicryLevel}
              onChange={(event) => setMimicryLevel(Number(event.target.value))}
              disabled={record.pending || profileLoading}
              aria-disabled={record.pending || profileLoading}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!hasChanged || record.pending || profileLoading}
              aria-disabled={!hasChanged || record.pending || profileLoading}
            >
              {record.pending ? "Saving..." : "Save Mimicry"}
            </button>
          </div>
        </form>
        {record.error ? (
          <p className="queue-meta action-inline-error" role="alert">
            {record.error}
          </p>
        ) : null}

        <div className="style-preview-grid" aria-label="Mimicry previews">
          <div className="style-preview-card">
            <span>Neutral context</span>
            <p>{previewNeutral}</p>
          </div>
          <div className="style-preview-card">
            <span>Playful context</span>
            <p>{previewPlayful}</p>
          </div>
        </div>
      </article>

      <article className="panel-card">
        <div className="style-section-head">
          <div>
            <p className="settings-eyebrow">Routing preview</p>
            <h3>Style Matrix</h3>
            <p className="queue-meta">Preview how relationship, register, and risk signals are classified before a reply is written.</p>
          </div>
        </div>
        <div className="style-matrix-grid">
          {STYLE_MATRIX_PREVIEWS.map((preview) => {
            const matrix = computeConversationStyleMatrix({
              inboundText: preview.inboundText,
              profileSlug: preview.profileSlug,
              threadKind: "threadKind" in preview ? preview.threadKind : undefined,
              learnedEmojiAllowlist: profile?.learnedEmojiAllowlist,
              learnedEmojiCategoryHints: profile?.learnedEmojiCategoryHints,
            });
            return (
              <div key={preview.label} className="queue-item style-matrix-card">
                <p className="queue-title">{preview.label}</p>
                <p className="queue-body">{preview.inboundText}</p>
                <p className="queue-meta">
                  {matrix.relationship} · {matrix.register} · {matrix.interactionMove} · {matrix.riskSensitivity}
                </p>
                <p className="queue-meta">
                  Emoji {matrix.emojiTextPolicy} · Confidence {Math.round(matrix.confidence * 100)}%
                  {matrix.dynamicStylePackIds.length ? ` · Packs ${matrix.dynamicStylePackIds.join(", ")}` : ""}
                </p>
              </div>
            );
          })}
        </div>
      </article>

      <article className="panel-card">
        <div className="style-section-head">
          <div>
            <p className="settings-eyebrow">Learned profile</p>
            <h3>Learned Traits</h3>
            <p className="queue-meta">Review the phrases, punctuation, spelling, humor, and emoji signals used as lightweight style guidance.</p>
          </div>
        </div>
        <div className="style-traits-toolbar">
          <div>
            <p className="queue-title">Phrase Cleanup</p>
            <p className="queue-meta">Remove awkward or generic learned phrases from the style profile.</p>
          </div>
          <div className="queue-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                void runAction(
                  "style:cleanup:preview",
                  async () => {
                    const result = (await cleanupCommonPhrases({ ...tenantScope, dryRun: true })) as PhraseCleanupResult;
                    setCleanupSummary(result);
                  },
                  {
                    pendingLabel: "Previewing cleanup...",
                    successMessage: "Cleanup preview refreshed.",
                  },
                )
              }
              disabled={cleanupPreviewRecord.pending || cleanupApplyRecord.pending}
              aria-disabled={cleanupPreviewRecord.pending || cleanupApplyRecord.pending}
            >
              {cleanupPreviewRecord.pending ? "Previewing..." : "Preview Cleanup"}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                void runAction(
                  "style:cleanup:apply",
                  async () => {
                    const result = (await cleanupCommonPhrases({ ...tenantScope, dryRun: false })) as PhraseCleanupResult;
                    setCleanupSummary(result);
                  },
                  {
                    pendingLabel: "Cleaning phrases...",
                    successMessage: "Cleanup started. Additional batches may continue in background.",
                  },
                )
              }
              disabled={cleanupPreviewRecord.pending || cleanupApplyRecord.pending}
              aria-disabled={cleanupPreviewRecord.pending || cleanupApplyRecord.pending}
            >
              {cleanupApplyRecord.pending ? "Cleaning..." : "Apply Cleanup"}
            </button>
          </div>
          {cleanupSummary ? (
            <p className="queue-meta">
              {cleanupSummary.dryRun ? "Preview" : "Applied"}: removed {cleanupSummary.removedPhraseCount} phrases across{" "}
              {cleanupSummary.updatedProfiles}/{cleanupSummary.scannedProfiles} style profiles.
              {!cleanupSummary.dryRun && !cleanupSummary.isDone
                ? " Additional batches are still running in background."
                : ""}
            </p>
          ) : (
            <p className="queue-meta">Run preview to see what will be removed before applying.</p>
          )}
          {cleanupPreviewRecord.error ? (
            <p className="queue-meta action-inline-error" role="alert">
              {cleanupPreviewRecord.error}
            </p>
          ) : null}
          {cleanupApplyRecord.error ? (
            <p className="queue-meta action-inline-error" role="alert">
              {cleanupApplyRecord.error}
            </p>
          ) : null}
        </div>
        <div className="style-trait-list">
          {!profileLoading ? (
            <div className="style-emoji-summary">
              <div>
                <span>Emoji allowlist</span>
                <strong>
                  {profile?.learnedEmojiAllowlist && profile.learnedEmojiAllowlist.length > 0
                    ? profile.learnedEmojiAllowlist.join(" ")
                    : "No signals yet"}
                </strong>
              </div>
              <div>
                <span>Category hints</span>
                <strong>
                  {profile?.learnedEmojiCategoryHints && profile.learnedEmojiCategoryHints.length > 0
                    ? profile.learnedEmojiCategoryHints.join(" · ")
                    : "No hints yet"}
                </strong>
              </div>
            </div>
          ) : null}
          {profileLoading ? (
            <LoadingBlock label="Loading learned traits…" rows={4} />
          ) : (
            LEARNED_TRAIT_SECTIONS.map((section) => {
              const values = traitsByField[section.trait];
              const addKey = `style:trait:add:${section.trait}`;
              const clearKey = `style:trait:clear:${section.trait}`;
              const addRecord = getRecord(addKey);
              const clearRecord = getRecord(clearKey);
              const addDraft = newTraitDrafts[section.trait];
              const addDraftTrimmed = addDraft.trim();
              const hasDuplicateDraft = values.some((item) => item.toLowerCase() === addDraftTrimmed.toLowerCase());
              const addPending = addRecord.pending || clearRecord.pending;
              return (
                <section key={section.trait} className="style-trait-section">
                  <div className="style-trait-head">
                    <div>
                      <h4>{section.label}</h4>
                      <p className="queue-meta">
                        {values.length === 0
                          ? section.emptyLabel
                          : `${values.length} learned entr${values.length === 1 ? "y" : "ies"}.`}
                      </p>
                    </div>
                    {values.length > 0 ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() =>
                          void runAction(
                            clearKey,
                            async () => {
                              await clearLearnedTraitSection({ ...tenantScope, trait: section.trait });
                              setNewTraitDrafts((prev) => ({ ...prev, [section.trait]: "" }));
                              if (editingTrait?.trait === section.trait) {
                                setEditingTrait(null);
                                setTraitDraft("");
                              }
                            },
                            {
                              pendingLabel: "Clearing traits...",
                              successMessage: `${section.label} cleared.`,
                            },
                          )
                        }
                        disabled={addPending}
                        aria-disabled={addPending}
                      >
                        {clearRecord.pending ? "Clearing..." : "Clear all"}
                      </button>
                    ) : null}
                  </div>
                  <form
                    className="style-inline-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!addDraftTrimmed || hasDuplicateDraft || addPending) {
                        return;
                      }
                      void runAction(
                        addKey,
                        async () => {
                          await updateLearnedTrait({
                            ...tenantScope,
                            trait: section.trait,
                            value: addDraft,
                          });
                          setNewTraitDrafts((prev) => ({ ...prev, [section.trait]: "" }));
                        },
                        {
                          pendingLabel: "Adding trait...",
                          successMessage: "Learned trait added.",
                        },
                      );
                    }}
                  >
                    <input
                      type="text"
                      placeholder={`Add ${section.label.toLowerCase()} entry`}
                      value={addDraft}
                      onChange={(event) => setNewTraitDrafts((prev) => ({ ...prev, [section.trait]: event.target.value }))}
                      disabled={addPending}
                      aria-disabled={addPending}
                    />
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={!addDraftTrimmed || hasDuplicateDraft || addPending}
                      aria-disabled={!addDraftTrimmed || hasDuplicateDraft || addPending}
                    >
                      {addRecord.pending ? "Adding..." : "Add"}
                    </button>
                    {hasDuplicateDraft ? (
                      <p className="queue-meta action-inline-error" role="status">
                        This entry already exists in this section.
                      </p>
                    ) : null}
                    {addRecord.error ? (
                      <p className="queue-meta action-inline-error" role="alert">
                        {addRecord.error}
                      </p>
                    ) : null}
                    {clearRecord.error ? (
                      <p className="queue-meta action-inline-error" role="alert">
                        {clearRecord.error}
                      </p>
                    ) : null}
                  </form>
                  {values.length === 0 ? (
                    <EmptyState
                      variant="style"
                      compact
                      title={section.emptyLabel}
                      description="Add a note manually or let learned style signals build up from conversation history."
                    />
                  ) : (
                    values.map((item) => {
                      const editKey = `style:trait:update:${section.trait}:${item}`;
                      const removeKey = `style:trait:remove:${section.trait}:${item}`;
                      const editRecord = getRecord(editKey);
                      const removeRecord = getRecord(removeKey);
                      const isEditing = editingTrait?.trait === section.trait && editingTrait.value === item;
                      const trimmedDraft = traitDraft.trim();
                      const unchanged = trimmedDraft === item.trim();
                      const actionPending = editRecord.pending || removeRecord.pending;

                      if (isEditing) {
                        return (
                          <form
                            key={`${section.trait}:${item}`}
                            className="queue-item style-trait-item style-trait-edit"
                            onSubmit={(event) => {
                              event.preventDefault();
                              if (!trimmedDraft || unchanged || actionPending) {
                                return;
                              }
                              void runAction(
                                editKey,
                                async () => {
                                  await updateLearnedTrait({
                                    ...tenantScope,
                                    trait: section.trait,
                                    previousValue: item,
                                    value: traitDraft,
                                  });
                                  setEditingTrait(null);
                                  setTraitDraft("");
                                },
                                {
                                  pendingLabel: "Saving trait...",
                                  successMessage: "Learned trait updated.",
                                },
                              );
                            }}
                          >
                            <input
                              type="text"
                              value={traitDraft}
                              onChange={(event) => setTraitDraft(event.target.value)}
                              disabled={actionPending}
                              aria-disabled={actionPending}
                            />
                            <div className="queue-actions">
                              <button
                                type="submit"
                                className="btn btn-primary"
                                disabled={!trimmedDraft || unchanged || actionPending}
                                aria-disabled={!trimmedDraft || unchanged || actionPending}
                              >
                                {editRecord.pending ? "Saving..." : "Save"}
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => {
                                  if (actionPending) {
                                    return;
                                  }
                                  setEditingTrait(null);
                                  setTraitDraft("");
                                }}
                                disabled={actionPending}
                                aria-disabled={actionPending}
                              >
                                Cancel
                              </button>
                            </div>
                            {editRecord.error ? (
                              <p className="queue-meta action-inline-error" role="alert">
                                {editRecord.error}
                              </p>
                            ) : null}
                          </form>
                        );
                      }

                      return (
                        <div key={`${section.trait}:${item}`} className="queue-item style-trait-item">
                          <p className="queue-body">{item}</p>
                          <div className="queue-actions">
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => {
                                if (actionPending) {
                                  return;
                                }
                                setEditingTrait({ trait: section.trait, value: item });
                                setTraitDraft(item);
                              }}
                              disabled={actionPending}
                              aria-disabled={actionPending}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() =>
                                void runAction(
                                  removeKey,
                                  async () => {
                                    await removeLearnedTrait({
                                      ...tenantScope,
                                      trait: section.trait,
                                      value: item,
                                    });
                                    if (isEditing) {
                                      setEditingTrait(null);
                                      setTraitDraft("");
                                    }
                                  },
                                  {
                                    pendingLabel: "Removing trait...",
                                    successMessage: "Learned trait removed.",
                                  },
                                )
                              }
                              disabled={actionPending}
                              aria-disabled={actionPending}
                            >
                              {removeRecord.pending ? "Removing..." : "Delete"}
                            </button>
                          </div>
                          {removeRecord.error ? (
                            <p className="queue-meta action-inline-error" role="alert">
                              {removeRecord.error}
                            </p>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </section>
              );
            })
          )}
        </div>

      </article>

      <article className="panel-card">
        <div className="style-section-head">
          <div>
            <p className="settings-eyebrow">Snapshots</p>
            <h3>Mimicry History</h3>
            <p className="queue-meta">Inspect recent mimicry saves and roll back when a profile starts feeling off.</p>
          </div>
        </div>
        <div className="style-history-list">
          {historyLoading ? <LoadingBlock label="Loading mimicry history…" rows={2} compact /> : null}
          {(history || []).map((item) => (
            <div key={item._id} className="queue-item queue-item-condensed style-history-row">
              <div>
                <p className="queue-title">{Math.round(item.mimicryLevel * 100)}%</p>
                <p className="queue-meta">
                  {item.reason || "snapshot"} · {new Date(item.createdAt).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  void runAction(
                    "style:rollback",
                    async () => {
                      await rollbackHistory({ ...tenantScope, historyId: item._id as Id<"styleProfileHistory"> });
                    },
                    {
                      pendingLabel: "Rolling back style...",
                      successMessage: "Style profile rolled back.",
                    },
                  )
                }
                disabled={rollbackRecord.pending}
                aria-disabled={rollbackRecord.pending}
              >
                Rollback
              </button>
            </div>
          ))}
          {history !== undefined && history.length === 0 ? (
            <EmptyState
              variant="style"
              title="No history yet."
              description="Style changes will create history entries you can inspect or roll back."
            />
          ) : null}
        </div>
      </article>

      <article className="panel-card">
        <div className="style-section-head">
          <div>
            <p className="settings-eyebrow">Pack library</p>
            <h3>Persona Pack</h3>
            <p className="queue-meta">Install or re-apply bundled packs. Active packs run only on matching thread profiles.</p>
          </div>
        </div>
        <div className="style-pack-list">
          {personaPacks === undefined ? (
            <LoadingBlock label="Loading persona packs…" rows={2} compact />
          ) : personaPacks.packs.length === 0 ? (
            <EmptyState
              variant="style"
              title="No persona packs available."
              description="Persona packs will appear here when they are bundled with the app."
            />
          ) : (
            personaPacks.packs.map((pack) => {
              const activeForProfileSlugs = pack.activeForProfileSlugs || [];
              const isActive = activeForProfileSlugs.length > 0 || personaPacks.activePersonaPackId === pack.id;
              const installingThisPack = installPackRecord.pending && installingPackId === pack.id;
              return (
                <div key={pack.id} className="queue-item style-pack-row">
                  <div>
                    <p className="queue-title">
                      {pack.name} ({pack.version})
                    </p>
                    <p className="queue-body">{pack.description}</p>
                    <p className="queue-meta">
                      Allowed profiles: {pack.allowedProfileSlugs.join(", ")}
                      {activeForProfileSlugs.length ? ` · Active for: ${activeForProfileSlugs.join(", ")}` : ""}
                      {!activeForProfileSlugs.length && pack.isLegacyActive ? " · Legacy active fallback" : ""}
                    </p>
                    {Array.isArray(pack.cohorts) && pack.cohorts.length > 0 ? (
                      <p className="queue-meta">
                        Cohorts: {pack.cohorts.join(", ")}
                        {typeof pack.scenarioCount === "number" ? ` · Scenarios: ${pack.scenarioCount}` : ""}
                      </p>
                    ) : typeof pack.scenarioCount === "number" && pack.scenarioCount > 0 ? (
                      <p className="queue-meta">Scenarios: {pack.scenarioCount}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setInstallingPackId(pack.id);
                      void runAction(
                        "style:persona-pack:install",
                        async () => {
                          await installPersonaPack({
                            ...tenantScope,
                            packId: pack.id,
                            autoActivate: true,
                          });
                        },
                        {
                          pendingLabel: "Installing persona pack...",
                          successMessage: `Persona pack ${pack.id} applied.`,
                        },
                      ).finally(() => {
                        setInstallingPackId((current) => (current === pack.id ? null : current));
                      });
                    }}
                    disabled={installPackRecord.pending}
                    aria-disabled={installPackRecord.pending}
                  >
                    {installingThisPack ? "Applying..." : isActive ? "Re-Apply Active Pack" : "Apply + Activate Pack"}
                  </button>
                  {installingThisPack ? (
                    <div className="style-pack-progress" role="status" aria-live="polite">
                      <span>Installing persona pack</span>
                      <div className="install-progress-track install-progress-track-indeterminate" role="progressbar" aria-label={`Installing ${pack.name}`}>
                        <span />
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
          {personaPacks ? (
            <p className="queue-meta">
              Quality gate default: {personaPacks.qualityGateMode} @ {personaPacks.qualityGateThreshold.toFixed(2)}
            </p>
          ) : null}
          {installPackRecord.error ? (
            <p className="queue-meta action-inline-error" role="alert">
              {installPackRecord.error}
            </p>
          ) : null}
        </div>
      </article>
    </section>
  );
}

export function LiveStyleLab() {
  return <StyleLabContent />;
}
