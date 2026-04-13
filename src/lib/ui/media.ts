export type MediaKind = "sticker" | "meme" | "image" | "video" | "audio" | "document";

export type MediaPreviewResource = {
  assetId: string;
  kind: MediaKind;
  mimeType: string;
  label: string;
  url: string | null;
};

export type UnifiedMediaItem = {
  id: string;
  assetId?: string;
  source: "message" | "library";
  createdAt: number;
  kind: MediaKind;
  mimeType: string;
  label: string;
  url: string | null;
  enabled: boolean;
  tags: string[];
  contextSummary?: string;
  contextTags?: string[];
  contextTriggers?: string[];
  contextAvoid?: string[];
  contextConfidence?: number;
  thread?: { _id: string; jid: string; title?: string } | null;
  message?:
    | {
        _id: string;
        direction: "inbound" | "outbound";
        text: string;
        messageType: string;
        mediaCaption?: string;
        messageAt: number;
      }
    | null;
};

export function isImageLikeMedia(kind: MediaKind, mimeType: string) {
  const normalizedMime = (mimeType || "").trim().toLowerCase();
  if (normalizedMime) {
    return normalizedMime.startsWith("image/");
  }
  return kind === "sticker" || kind === "meme" || kind === "image";
}
