export function isStrictSelfControlScope(args: {
  selfAccount: string;
  threadAccount: string;
  senderAccount: string;
  fromMe: boolean;
}) {
  const self = (args.selfAccount || "").trim();
  const thread = (args.threadAccount || "").trim();
  const sender = (args.senderAccount || "").trim();
  if (!self || !thread) {
    return false;
  }
  const effectiveSender = args.fromMe ? self : sender;
  return thread === self && effectiveSender === self;
}
