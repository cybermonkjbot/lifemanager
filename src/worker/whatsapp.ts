import type { proto } from "baileys";

export type ParsedInboundMessage =
  | {
      kind: "text";
      text: string;
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

export function parseInboundMessage(message: proto.IMessage | null | undefined): ParsedInboundMessage {
  if (!message) {
    return { kind: "unsupported", text: "" };
  }

  if (message.reactionMessage) {
    const emoji = (message.reactionMessage.text || "").trim();
    const targetWhatsAppMessageId = message.reactionMessage.key?.id || undefined;
    return {
      kind: "reaction",
      text: emoji ? `Reacted with ${emoji}` : "Removed reaction",
      emoji,
      targetWhatsAppMessageId,
    };
  }

  if (message.stickerMessage) {
    const caption = message.stickerMessage.accessibilityLabel || "";
    return {
      kind: "sticker",
      text: "[Sticker]",
      caption: caption.trim() || undefined,
    };
  }

  const text = extractTextFromMessage(message);
  if (text) {
    return { kind: "text", text };
  }

  return { kind: "unsupported", text: "" };
}

export function getThreadJid(messageKey: proto.IMessageKey | null | undefined) {
  return messageKey?.remoteJid || "";
}

export function getSenderJid(messageKey: proto.IMessageKey | null | undefined) {
  return messageKey?.participant || messageKey?.remoteJid || "";
}
