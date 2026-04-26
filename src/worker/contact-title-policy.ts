export type SenderTitleCandidate = {
  title?: string;
  rank: number;
};

export type SenderTitleSelectionArgs = {
  existingPreferred?: SenderTitleCandidate;
  candidates: SenderTitleCandidate[];
};

export function selectPreferredSenderTitle(args: SenderTitleSelectionArgs) {
  const firstCandidate = args.candidates.find((candidate) => Boolean(candidate.title));
  if (!firstCandidate?.title) {
    return undefined;
  }

  if ((args.existingPreferred?.rank || 0) > firstCandidate.rank && args.existingPreferred?.title) {
    return args.existingPreferred;
  }
  return firstCandidate;
}

