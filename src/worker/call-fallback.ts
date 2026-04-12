export type CallFallbackSessionSnapshot = {
  lastStatus?: string;
  acceptedAt?: number;
};

export function shouldSuppressCallFallbackAfterOffer(
  snapshot: CallFallbackSessionSnapshot | null | undefined,
) {
  if (!snapshot) {
    return false;
  }

  if (Number.isFinite(snapshot.acceptedAt) && (snapshot.acceptedAt || 0) > 0) {
    return true;
  }

  const status = (snapshot.lastStatus || "").trim().toLowerCase();
  return status === "accept";
}
