export function normalizeHexHashToken(value?: string | null) {
  const normalized = value?.trim().toLowerCase() || "";
  if (!normalized) {
    return undefined;
  }
  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length % 2 !== 0) {
    return undefined;
  }
  return normalized;
}

function toHexFromBytes(value: Uint8Array) {
  if (!value || value.length === 0) {
    return undefined;
  }
  return Buffer.from(value).toString("hex").toLowerCase();
}

export function normalizeProviderHashValue(value: unknown) {
  if (!value) {
    return undefined;
  }
  if (value instanceof Uint8Array) {
    return toHexFromBytes(value);
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  const asHex = normalizeHexHashToken(trimmed);
  if (asHex) {
    return asHex;
  }
  const normalizedBase64 = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalizedBase64) || normalizedBase64.length % 4 !== 0) {
    return undefined;
  }
  try {
    return toHexFromBytes(Buffer.from(normalizedBase64, "base64"));
  } catch {
    return undefined;
  }
}

function unwrapNestedWhatsAppMessage(message: unknown) {
  if (!message || typeof message !== "object") {
    return message;
  }
  let current = message as {
    ephemeralMessage?: { message?: unknown };
    viewOnceMessage?: { message?: unknown };
    viewOnceMessageV2?: { message?: unknown };
    viewOnceMessageV2Extension?: { message?: unknown };
    deviceSentMessage?: { message?: unknown };
    documentWithCaptionMessage?: { message?: unknown };
    editedMessage?: { message?: unknown };
    groupMentionedMessage?: { message?: unknown };
    lottieStickerMessage?: { message?: unknown };
  };

  for (let i = 0; i < 8; i += 1) {
    const next =
      current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.viewOnceMessageV2Extension?.message ||
      current.deviceSentMessage?.message ||
      current.documentWithCaptionMessage?.message ||
      current.editedMessage?.message ||
      current.groupMentionedMessage?.message ||
      current.lottieStickerMessage?.message;
    if (!next || typeof next !== "object") {
      return current;
    }
    current = next as typeof current;
  }
  return current;
}

export function extractStickerProviderContentHashFromMessage(message: unknown) {
  const root = (message as { message?: unknown } | null | undefined)?.message;
  const unwrapped = unwrapNestedWhatsAppMessage(root) as {
    stickerMessage?: { fileSha256?: Uint8Array | string | null };
    lottieStickerMessage?: { fileSha256?: Uint8Array | string | null };
  } | null;
  if (!unwrapped) {
    return undefined;
  }
  const raw = unwrapped.stickerMessage?.fileSha256 ?? unwrapped.lottieStickerMessage?.fileSha256;
  return normalizeProviderHashValue(raw);
}

export function shouldCaptureMediaAfterIngest(args: {
  duplicate?: boolean;
  hasMediaKind: boolean;
  hasMessageId: boolean;
  shouldCaptureGroupMedia: boolean;
  isGroupThread: boolean;
}) {
  if (args.duplicate) {
    return false;
  }
  if (!args.hasMediaKind || !args.hasMessageId) {
    return false;
  }
  if (args.shouldCaptureGroupMedia) {
    return true;
  }
  return !args.isGroupThread;
}
