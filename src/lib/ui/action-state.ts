"use client";

import { useCallback, useMemo, useRef, useState } from "react";

export type ActionNoticeKind = "success" | "error" | "info";

export type ActionNotice = {
  id: string;
  kind: ActionNoticeKind;
  message: string;
  createdAt: number;
};

export type ActionRecord = {
  pending: boolean;
  error?: string;
  lastSuccessAt?: number;
  pendingLabel?: string;
};

type RunActionOptions = {
  pendingLabel?: string;
  successMessage?: string;
  errorMessage?: string;
  suppressSuccessNotice?: boolean;
};

type RunActionResult<T> = {
  executed: boolean;
  value?: T;
  error?: string;
};

const EMPTY_RECORD: ActionRecord = {
  pending: false,
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Something went wrong. Please try again.";
}

export function useActionStateRegistry() {
  const [records, setRecords] = useState<Record<string, ActionRecord>>({});
  const [notices, setNotices] = useState<ActionNotice[]>([]);
  const pendingRef = useRef<Set<string>>(new Set());

  const upsertRecord = useCallback((key: string, patch: Partial<ActionRecord>) => {
    setRecords((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? EMPTY_RECORD),
        ...patch,
      },
    }));
  }, []);

  const pushNotice = useCallback((kind: ActionNoticeKind, message: string) => {
    const id = `${kind}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = Date.now();

    setNotices((current) => {
      const next = [...current, { id, kind, message, createdAt }];
      if (next.length > 6) {
        return next.slice(next.length - 6);
      }
      return next;
    });
  }, []);

  const dismissNotice = useCallback((id: string) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const clearError = useCallback((key: string) => {
    upsertRecord(key, { error: undefined });
  }, [upsertRecord]);

  const runAction = useCallback(
    async <T>(key: string, operation: () => Promise<T>, options?: RunActionOptions): Promise<RunActionResult<T>> => {
      if (pendingRef.current.has(key)) {
        return {
          executed: false,
        };
      }

      pendingRef.current.add(key);
      upsertRecord(key, {
        pending: true,
        error: undefined,
        pendingLabel: options?.pendingLabel,
      });

      try {
        const value = await operation();
        upsertRecord(key, {
          pending: false,
          pendingLabel: undefined,
          lastSuccessAt: Date.now(),
          error: undefined,
        });

        if (options?.successMessage && !options.suppressSuccessNotice) {
          pushNotice("success", options.successMessage);
        }

        return {
          executed: true,
          value,
        };
      } catch (error) {
        const message = options?.errorMessage || getErrorMessage(error);
        upsertRecord(key, {
          pending: false,
          pendingLabel: undefined,
          error: message,
        });
        pushNotice("error", message);

        return {
          executed: true,
          error: message,
        };
      } finally {
        pendingRef.current.delete(key);
      }
    },
    [pushNotice, upsertRecord],
  );

  const getRecord = useCallback(
    (key: string) => {
      return records[key] ?? EMPTY_RECORD;
    },
    [records],
  );

  const isPending = useCallback(
    (key: string) => {
      return Boolean(records[key]?.pending);
    },
    [records],
  );

  const anyPending = useMemo(() => {
    return Object.values(records).some((record) => record.pending);
  }, [records]);

  return {
    runAction,
    getRecord,
    isPending,
    clearError,
    anyPending,
    notices,
    pushNotice,
    dismissNotice,
  };
}
