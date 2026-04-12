function normalizeReactionText(text: string) {
  return (text || "").trim().toLowerCase();
}

export function chooseReactionEmoji(text: string) {
  const normalized = normalizeReactionText(text);
  if (!normalized) {
    return "👍";
  }

  if (/\b(rip|condolence|sorry for your loss|funeral|burial|passed away|rest in peace)\b/i.test(normalized)) {
    return "🙏";
  }

  if (/\b(thanks|thank you|thx|tnx|appreciate|god bless|bless you|amen)\b/i.test(normalized)) {
    return "🙏";
  }

  if (
    /\b(congrats|congratulations|happy birthday|birthday|anniversary|promotion|well done|you made it|won|victory|success)\b/i.test(
      normalized,
    )
  ) {
    return "🎉";
  }

  if (/\b(lol|lmao|lmfao|haha|hehe|funny|hilarious|dead)\b|[😂🤣😹😆😄😁😅]/u.test(normalized)) {
    return "😂";
  }

  if (/\b(love|luv|miss you|xoxo|darling|sweetheart|baby|babe|heart)\b|[❤️💖💕💘]/u.test(normalized)) {
    return "❤️";
  }

  if (/\b(sorry|my bad|apolog(?:y|ize|ise))\b/i.test(normalized)) {
    return "🙏";
  }

  if (/\b(great|awesome|amazing|perfect|excellent|fire|lit|dope|nice one|solid)\b/i.test(normalized)) {
    return "🔥";
  }

  if (/^\[(voice note|audio)\]/i.test(normalized)) {
    return "🎧";
  }

  if (/^\[(image|video|document)\]/i.test(normalized)) {
    return "👀";
  }

  if (/^\[(sticker|reaction)\]/i.test(normalized)) {
    return "😂";
  }

  if (/\b(hi|hello|hey|yo|good morning|good afternoon|good evening|good night)\b/i.test(normalized)) {
    return "👋";
  }

  if (/\?|(?:\b(can|could|will|would|when|where|what|why|how|who)\b)|(?:\b(check|look|see|watch|read|listen)\b)/i.test(normalized)) {
    return "👀";
  }

  if (/\b(ok|okay|sure|alright|cool|noted|done|sounds good|bet|safe|seen|confirmed)\b/i.test(normalized)) {
    return "👍";
  }

  return "👍";
}
