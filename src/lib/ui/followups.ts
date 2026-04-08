import type { Id } from "../../../convex/_generated/dataModel";

export type FollowupStatus = "suggested" | "confirmed" | "queued" | "sent" | "failed" | "cancelled";
export type FollowupKind = "promise" | "request" | "plan";
export type FollowupDirection = "inbound" | "outbound";

export type FollowupSourceMessage = {
  text?: string;
  messageAt?: number;
  direction?: FollowupDirection;
};

export type FollowupThreadRef = {
  _id?: string;
  title?: string;
  jid?: string;
};

export type FollowupItem = {
  _id: string;
  threadId?: string;
  reason: string;
  dueAt: number;
  status: FollowupStatus;
  kind?: FollowupKind;
  direction?: FollowupDirection;
  confidence?: number;
  sourceSnippet?: string;
  thread?: FollowupThreadRef | null;
  sourceMessage?: FollowupSourceMessage | null;
};

type RunAction = (
  key: string,
  action: () => Promise<void>,
  options: {
    pendingLabel: string;
    successMessage: string;
  },
) => void;

type FollowupMutations = {
  confirmFollowup: (args: { followUpId: Id<"followUps"> }) => Promise<unknown>;
  snoozeFollowup: (args: { followUpId: Id<"followUps">; minutes: number }) => Promise<unknown>;
  rescheduleFollowup: (args: { followUpId: Id<"followUps">; dueAt: number }) => Promise<unknown>;
  cancelFollowup: (args: { followUpId: Id<"followUps"> }) => Promise<unknown>;
};

export function followupStatusLabel(status: FollowupStatus) {
  if (status === "suggested") {
    return "Needs review";
  }
  if (status === "confirmed") {
    return "Confirmed";
  }
  if (status === "queued") {
    return "Queued";
  }
  if (status === "sent") {
    return "Sent";
  }
  if (status === "failed") {
    return "Failed";
  }
  return "Dismissed";
}

export function followupCommitmentLabel(item: Pick<FollowupItem, "direction" | "kind">) {
  if (item.direction === "outbound" && item.kind !== "request") {
    return "You promised";
  }
  if (item.direction === "inbound" && item.kind === "request") {
    return "They requested";
  }
  if (item.kind === "plan") {
    return "Shared plan";
  }
  return "Commitment";
}

export function followupRescheduleDueAt(hoursAhead: number, now = Date.now()) {
  return now + Math.max(1, Math.round(hoursAhead)) * 60 * 60 * 1000;
}

export function createFollowupActionHandlers(args: {
  runAction: RunAction;
  mutations: FollowupMutations;
}) {
  const { runAction, mutations } = args;

  const onConfirm = (followUpId: string) => {
    const key = `followup:${followUpId}`;
    void runAction(
      key,
      async () => {
        await mutations.confirmFollowup({ followUpId: followUpId as Id<"followUps"> });
      },
      {
        pendingLabel: "Confirming…",
        successMessage: "Follow-up confirmed.",
      },
    );
  };

  const onSnooze = (followUpId: string, minutes: number) => {
    const key = `followup:snooze:${followUpId}`;
    void runAction(
      key,
      async () => {
        await mutations.snoozeFollowup({ followUpId: followUpId as Id<"followUps">, minutes });
      },
      {
        pendingLabel: "Snoozing…",
        successMessage: "Follow-up snoozed.",
      },
    );
  };

  const onReschedule = (followUpId: string, hoursAhead: number) => {
    const key = `followup:reschedule:${followUpId}`;
    void runAction(
      key,
      async () => {
        await mutations.rescheduleFollowup({
          followUpId: followUpId as Id<"followUps">,
          dueAt: followupRescheduleDueAt(hoursAhead),
        });
      },
      {
        pendingLabel: "Rescheduling…",
        successMessage: "Follow-up rescheduled.",
      },
    );
  };

  const onDismiss = (followUpId: string) => {
    const key = `followup:cancel:${followUpId}`;
    void runAction(
      key,
      async () => {
        await mutations.cancelFollowup({ followUpId: followUpId as Id<"followUps"> });
      },
      {
        pendingLabel: "Dismissing…",
        successMessage: "Follow-up dismissed.",
      },
    );
  };

  return {
    onConfirm,
    onSnooze,
    onReschedule,
    onDismiss,
  };
}
