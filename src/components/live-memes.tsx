"use client";

import { ActionNotices } from "@/components/action-notices";
import { SearchableSelect } from "@/components/app-ui";
import { EmptyState } from "@/components/empty-state";
import { LoadingBlock } from "@/components/loading-state";
import { SharedMediaPreview } from "@/components/media-preview";
import { useTenantScopeArgs } from "@/components/tenant-scope-provider";
import { UIModal } from "@/components/ui-modal";
import { formatDateTime, trim } from "@/lib/format";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import type { MediaKind } from "@/lib/ui/media";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";

type MemeAsset = {
  _id: string;
  kind: "meme";
  label: string;
  tags: string[];
  enabled: boolean;
  source?: "uploaded" | "generated" | "captured";
  threadId?: string;
  fileUrl?: string | null;
  mimeType: string;
  contentHash?: string;
  generationPromptHash?: string;
  generationContextSnippet?: string;
  createdAt: number;
  updatedAt: number;
};

type KnownContact = {
  _id: string;
  jid: string;
  title?: string;
};

type MemePreview = {
  url: string;
  label: string;
  mimeType: string;
  kind: MediaKind;
};

type GeneratedMemeResponse = {
  assetId: string;
  label: string;
  mimeType: string;
  url: string | null;
  model: string;
  latencyMs: number;
  createdAt: number;
};
const MAX_MEME_PROMPT_CHARS = 8000;

async function readApiError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload?.error && payload.error.trim()) {
      return payload.error.trim();
    }
  } catch {
    // Ignore non-JSON error payloads.
  }

  return `Request failed (${response.status}).`;
}

export function LiveMemes() {
  const tenantScope = useTenantScopeArgs();
  const { runAction, getRecord, notices, dismissNotice } = useActionStateRegistry();
  const [prompt, setPrompt] = useState("");
  const [label, setLabel] = useState("");
  const [threadId, setThreadId] = useState("none");
  const [preview, setPreview] = useState<MemePreview | null>(null);
  const [lastGenerated, setLastGenerated] = useState<GeneratedMemeResponse | null>(null);

  const contacts = useQuery(api.threads.listContacts, { ...tenantScope, limit: 300 }) as KnownContact[] | undefined;
  const memeAssets = useQuery(api.media.listAssets, { ...tenantScope, kind: "meme" }) as MemeAsset[] | undefined;

  const contactById = useMemo(() => {
    return new Map((contacts || []).map((item) => [item._id, item]));
  }, [contacts]);

  const generatedMemes = useMemo(() => {
    return (memeAssets || []).filter((asset) => (asset.source || "uploaded") === "generated");
  }, [memeAssets]);

  const key = "memes:manual-generate";
  const record = getRecord(key);
  const loading = memeAssets === undefined;
  const contactsLoading = contacts === undefined;
  const canGenerate = prompt.trim().length > 0 && !record.pending;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!prompt.trim()) {
      return;
    }

    void runAction(
      key,
      async () => {
        const response = await fetch("/api/actions/generate-meme", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: prompt.trim(),
            label: label.trim() || undefined,
            threadId: threadId === "none" ? undefined : threadId,
          }),
        });

        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        const payload = (await response.json()) as GeneratedMemeResponse;
        setLastGenerated(payload);
        return payload;
      },
      {
        pendingLabel: "Generating meme image...",
        successMessage: "Meme generated and saved.",
      },
    );
  };

  return (
    <section className="panel-grid two-col memes-workspace">
      <article className="panel-card">
        <ActionNotices notices={notices} onDismiss={dismissNotice} />
        <h3>Manual Meme Generator</h3>
        <p className="queue-meta">Generate a meme on demand and save it straight into your meme library.</p>

        <form onSubmit={onSubmit} className="stack compact" aria-busy={record.pending}>
          <label className="stack compact">
            <span className="queue-meta">Prompt</span>
            <textarea
              rows={5}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe the meme reaction you want..."
              maxLength={MAX_MEME_PROMPT_CHARS}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
            <span className="queue-meta">
              {prompt.length}/{MAX_MEME_PROMPT_CHARS} characters
            </span>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Label (optional)</span>
            <input
              type="text"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Optional custom label"
              disabled={record.pending}
              aria-disabled={record.pending}
              maxLength={120}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Thread context (optional)</span>
            <SearchableSelect
              value={threadId}
              onChange={(event) => setThreadId(event.target.value)}
              disabled={record.pending || contactsLoading}
              aria-disabled={record.pending || contactsLoading}
            >
              <option value="none">No thread context</option>
              {(contacts || []).map((contact) => (
                <option key={contact._id} value={contact._id}>
                  {(contact.title?.trim() || contact.jid).slice(0, 120)}
                </option>
              ))}
            </SearchableSelect>
          </label>

          <button type="submit" className="btn btn-primary" disabled={!canGenerate} aria-disabled={!canGenerate}>
            {record.pending ? "Generating..." : "Generate Meme"}
          </button>
        </form>

        {record.pendingLabel ? <p className="action-pending-label">{record.pendingLabel}</p> : null}
        {record.error ? (
          <p className="queue-meta action-inline-error" role="alert">
            {record.error}
          </p>
        ) : null}

        {lastGenerated ? (
          <div className="queue-item media-dashboard-item">
            <div className="media-dashboard-main">
              <SharedMediaPreview
                preview={{
                  assetId: lastGenerated.assetId,
                  kind: "meme",
                  mimeType: lastGenerated.mimeType,
                  label: lastGenerated.label,
                  url: lastGenerated.url,
                }}
                mediaAssetId={lastGenerated.assetId}
                onOpenImagePreview={(item) =>
                  setPreview({
                    url: item.url,
                    label: item.label,
                    mimeType: item.mimeType,
                    kind: item.kind,
                  })
                }
                imageButtonClassName="message-media-open media-dashboard-preview"
              />
              <div className="media-dashboard-content">
                <p className="queue-title">Latest Generated Meme</p>
                <p className="queue-meta">
                  {lastGenerated.model} · {lastGenerated.latencyMs}ms · {formatDateTime(lastGenerated.createdAt)}
                </p>
                <p className="queue-body">{trim(lastGenerated.label, 140)}</p>
                {lastGenerated.url ? (
                  <a href={lastGenerated.url} target="_blank" rel="noreferrer" className="btn btn-ghost">
                    Open Raw
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            variant="media"
            compact
            title="No generated preview yet."
            description="Create a meme to preview the latest output before using it."
          />
        )}
      </article>

      <article className="panel-card">
        <h3>Generated Meme Library</h3>
        <p className="queue-meta">
          Showing {generatedMemes.length} generated meme{generatedMemes.length === 1 ? "" : "s"} from your stored assets.
        </p>
        <p className="queue-meta">
          Meme availability, tags, and cleanup live in <Link href="/settings?section=media">Media Settings</Link>.
        </p>

        {loading ? <LoadingBlock label="Loading generated memes..." rows={4} /> : null}
        {!loading && generatedMemes.length === 0 ? (
          <EmptyState
            variant="media"
            title="No generated meme assets saved yet."
            description="Generated meme assets will appear here after they are created."
          />
        ) : null}

        <div className="stack">
          {generatedMemes.map((asset) => {
            const sourceThread = asset.threadId ? contactById.get(asset.threadId) : null;
            return (
              <div key={asset._id} className="queue-item media-dashboard-item">
                <div className="media-dashboard-main">
                  <SharedMediaPreview
                    preview={{
                      assetId: asset._id,
                      kind: "meme",
                      mimeType: asset.mimeType,
                      label: asset.label,
                      url: asset.fileUrl || null,
                    }}
                    mediaAssetId={asset._id}
                    onOpenImagePreview={(item) =>
                      setPreview({
                        url: item.url,
                        label: item.label,
                        mimeType: item.mimeType,
                        kind: item.kind,
                      })
                    }
                    imageButtonClassName="message-media-open media-dashboard-preview"
                  />
                  <div className="media-dashboard-content">
                    <p className="queue-title">{asset.label || "Generated meme"}</p>
                    <p className="queue-meta">{formatDateTime(asset.createdAt)}</p>
                    <p className="queue-meta">{asset.mimeType || "unknown mime type"}</p>
                    {sourceThread ? <p className="queue-meta">Thread: {(sourceThread.title?.trim() || sourceThread.jid).slice(0, 120)}</p> : null}
                    {asset.tags.length > 0 ? <p className="queue-meta">Tags: {asset.tags.join(", ")}</p> : null}
                    {asset.generationContextSnippet ? <p className="queue-body">{trim(asset.generationContextSnippet, 260)}</p> : null}
                    {asset.fileUrl ? (
                      <a href={asset.fileUrl} target="_blank" rel="noreferrer" className="btn btn-ghost">
                        Open Raw
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </article>

      <UIModal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.label || "Meme Preview"}
        description={preview?.mimeType || "Preview the selected meme."}
      >
        {preview?.url ? (
          <div className="stack compact">
            <SharedMediaPreview
              preview={{
                assetId: "meme-modal-preview",
                kind: preview.kind,
                mimeType: preview.mimeType,
                label: preview.label,
                url: preview.url,
              }}
              mediaAssetId="meme-modal-preview"
              imageClassName="message-media-image modal-preview-image"
              attachmentText="Open full size"
            />
            <a href={preview.url} target="_blank" rel="noreferrer" className="message-media-link">
              Open full size
            </a>
          </div>
        ) : (
          <EmptyState
            variant="media"
            compact
            title="Meme preview unavailable."
            description="The saved asset is present, but its preview URL is missing."
          />
        )}
      </UIModal>
    </section>
  );
}
