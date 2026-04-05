import type { proto } from "baileys";

export function extractTextFromMessage(message: proto.IMessage | null | undefined) {
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

export function getThreadJid(messageKey: proto.IMessageKey | null | undefined) {
  return messageKey?.remoteJid || "";
}

export function getSenderJid(messageKey: proto.IMessageKey | null | undefined) {
  return messageKey?.participant || messageKey?.remoteJid || "";
}
