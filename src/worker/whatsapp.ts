import type { proto } from "baileys";

export type ParsedInboundMessage =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "image";
      text: string;
      caption?: string;
      mimeType?: string;
    }
  | {
      kind: "reaction";
      text: string;
      emoji: string;
      targetWhatsAppMessageId?: string;
    }
  | {
      kind: "sticker";
      text: string;
      caption?: string;
      mimeType?: string;
    }
  | {
      kind: "audio";
      text: string;
      mimeType?: string;
      durationSeconds?: number;
      isVoiceNote: boolean;
    }
  | {
      kind: "video";
      text: string;
      caption?: string;
      mimeType?: string;
    }
  | {
      kind: "document";
      text: string;
      caption?: string;
      fileName?: string;
      mimeType?: string;
    }
  | {
      kind: "unsupported";
      text: "";
    };

function extractTextFromMessage(message: proto.IMessage | null | undefined) {
  if (!message) {
    return "";
  }

  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.buttonsResponseMessage?.selectedDisplayText ||
    message.listResponseMessage?.title ||
    ""
  ).trim();
}

function unwrapNestedMessage(message: proto.IMessage | null | undefined): proto.IMessage | null | undefined {
  if (!message) {
    return message;
  }

  let current: proto.IMessage | null | undefined = message;
  for (let i = 0; i < 8; i += 1) {
    if (!current) {
      return current;
    }
    const next: proto.IMessage | null | undefined =
      current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.viewOnceMessageV2Extension?.message ||
      current.documentWithCaptionMessage?.message ||
      current.editedMessage?.message ||
      current.groupMentionedMessage?.message ||
      current.lottieStickerMessage?.message;
    if (!next) {
      return current;
    }
    current = next;
  }
  return current;
}

export function parseInboundMessage(message: proto.IMessage | null | undefined): ParsedInboundMessage {
  const unwrapped = unwrapNestedMessage(message);
  if (!unwrapped) {
    return { kind: "unsupported", text: "" };
  }

  if (unwrapped.reactionMessage) {
    const emoji = (unwrapped.reactionMessage.text || "").trim();
    const targetWhatsAppMessageId = unwrapped.reactionMessage.key?.id || undefined;
    return {
      kind: "reaction",
      text: emoji ? `Reacted with ${emoji}` : "Removed reaction",
      emoji,
      targetWhatsAppMessageId,
    };
  }

  if (unwrapped.imageMessage) {
    const caption = (unwrapped.imageMessage.caption || "").trim() || undefined;
    const mimeType = (unwrapped.imageMessage.mimetype || "").trim() || undefined;
    return {
      kind: "image",
      text: caption ? `[Image] ${caption}` : "[Image]",
      caption,
      mimeType,
    };
  }

  if (unwrapped.stickerMessage || unwrapped.lottieStickerMessage) {
    const caption = unwrapped.stickerMessage?.accessibilityLabel || "";
    const mimeType = (unwrapped.stickerMessage?.mimetype || "").trim() || undefined;
    return {
      kind: "sticker",
      text: "[Sticker]",
      caption: caption.trim() || undefined,
      mimeType,
    };
  }

  if (unwrapped.audioMessage) {
    const mimeType = (unwrapped.audioMessage.mimetype || "").trim() || undefined;
    const durationRaw = Number(unwrapped.audioMessage.seconds);
    const durationSeconds = Number.isFinite(durationRaw) && durationRaw > 0 ? Math.round(durationRaw) : undefined;
    const isVoiceNote = Boolean(unwrapped.audioMessage.ptt);
    return {
      kind: "audio",
      text: isVoiceNote ? "[Voice note]" : "[Audio]",
      mimeType,
      durationSeconds,
      isVoiceNote,
    };
  }

  if (unwrapped.videoMessage || unwrapped.ptvMessage) {
    const caption = (unwrapped.videoMessage?.caption || "").trim() || undefined;
    const mimeType = (unwrapped.videoMessage?.mimetype || unwrapped.ptvMessage?.mimetype || "").trim() || undefined;
    return {
      kind: "video",
      text: caption ? `[Video] ${caption}` : "[Video]",
      caption,
      mimeType,
    };
  }

  if (unwrapped.documentMessage) {
    const caption = (unwrapped.documentMessage.caption || "").trim() || undefined;
    const fileName = (unwrapped.documentMessage.fileName || "").trim() || undefined;
    const mimeType = (unwrapped.documentMessage.mimetype || "").trim() || undefined;
    const label = fileName ? `[Document] ${fileName}` : "[Document]";
    return {
      kind: "document",
      text: caption ? `${label} ${caption}` : label,
      caption,
      fileName,
      mimeType,
    };
  }

  const text = extractTextFromMessage(unwrapped);
  if (text) {
    return { kind: "text", text };
  }

  return { kind: "unsupported", text: "" };
}

export function isGroupJid(jid: string) {
  return jid.endsWith("@g.us");
}

export function isBroadcastOrSystemJid(jid: string) {
  if (!jid) {
    return false;
  }
  if (jid === "status@broadcast") {
    return true;
  }
  if (jid.startsWith("status@")) {
    return true;
  }
  return jid.endsWith("@broadcast") || jid.endsWith("@newsletter");
}

export function classifyThreadKindFromJid(jid: string): "direct" | "group" | "broadcast_or_system" {
  if (isBroadcastOrSystemJid(jid)) {
    return "broadcast_or_system";
  }
  if (isGroupJid(jid)) {
    return "group";
  }
  return "direct";
}

export function getThreadJid(messageKey: proto.IMessageKey | null | undefined) {
  return messageKey?.remoteJid || "";
}

export function getSenderJid(messageKey: proto.IMessageKey | null | undefined) {
  return messageKey?.participant || messageKey?.remoteJid || "";
}
