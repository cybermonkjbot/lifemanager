import { isImageLikeMedia, type MediaPreviewResource } from "@/lib/ui/media";

type SharedImagePreviewPayload = {
  assetId: string;
  url: string;
  label: string;
  mimeType: string;
  kind: MediaPreviewResource["kind"];
};

type SharedMediaPreviewProps = {
  preview?: MediaPreviewResource | null;
  mediaAssetId?: string;
  onOpenImagePreview?: (preview: SharedImagePreviewPayload) => void;
  imageButtonClassName?: string;
  imageClassName?: string;
  unavailableText?: string;
  attachmentText?: string;
};

export function SharedMediaPreview({
  preview,
  mediaAssetId,
  onOpenImagePreview,
  imageButtonClassName = "message-media-open",
  imageClassName = "message-media-image",
  unavailableText = "Media preview unavailable.",
  attachmentText = "Open media attachment",
}: SharedMediaPreviewProps) {
  if (!preview?.url) {
    return mediaAssetId ? <p className="queue-meta">{unavailableText}</p> : null;
  }

  const mimeType = preview.mimeType.toLowerCase();
  const altText = preview.label || (preview.kind === "meme" ? "Meme" : preview.kind === "sticker" ? "Sticker" : "Media");

  if (isImageLikeMedia(preview.kind, mimeType)) {
    if (onOpenImagePreview) {
      return (
        <button
          type="button"
          className={imageButtonClassName}
          onClick={() =>
            onOpenImagePreview({
              assetId: preview.assetId,
              url: preview.url!,
              label: preview.label,
              mimeType: preview.mimeType,
              kind: preview.kind,
            })
          }
          aria-label={`Open ${altText}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.url} alt={altText} className={imageClassName} loading="lazy" />
        </button>
      );
    }

    // eslint-disable-next-line @next/next/no-img-element
    return <img src={preview.url} alt={altText} className={imageClassName} loading="lazy" />;
  }

  if (mimeType.startsWith("video/") || preview.kind === "video") {
    return <video src={preview.url} controls preload="metadata" className="message-media-video" />;
  }

  if (mimeType.startsWith("audio/") || preview.kind === "audio") {
    return <audio src={preview.url} controls preload="none" className="message-media-audio" />;
  }

  return (
    <a href={preview.url} target="_blank" rel="noreferrer" className="message-media-link">
      {attachmentText}
    </a>
  );
}
