export function isStrictSelfControlScope(args: {
  selfAccount?: string;
  selfAccounts?: string[];
  threadAccount: string;
  senderAccount: string;
  fromMe: boolean;
}) {
  const selfSet = new Set<string>();
  const pushSelf = (value: string | undefined) => {
    const trimmed = (value || "").trim();
    if (!trimmed) {
      return;
    }
    selfSet.add(trimmed);
  };
  pushSelf(args.selfAccount);
  for (const selfAccount of args.selfAccounts || []) {
    pushSelf(selfAccount);
  }

  const thread = (args.threadAccount || "").trim();
  const sender = (args.senderAccount || "").trim();
  if (selfSet.size === 0 || !thread) {
    return false;
  }

  if (!selfSet.has(thread)) {
    return false;
  }
  if (args.fromMe) {
    return true;
  }
  return selfSet.has(sender);
}
