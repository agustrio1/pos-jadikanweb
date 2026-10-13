import { liveQuery } from "dexie";
import { useEffect, useMemo, useState } from "react";
import { getDb } from "./db";
import type { OutboxSale } from "./types";

export function useOutbox() {
  const [rows, setRows] = useState<OutboxSale[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let db: ReturnType<typeof getDb>;
    try {
      db = getDb();
    } catch {
      setReady(true);
      return;
    }

    const subscription = liveQuery(async () => {
      const [list, noticeRow] = await Promise.all([
        db.outbox.orderBy("createdAt").reverse().toArray(),
        db.meta.get("syncNotice"),
      ]);
      return {
        list,
        notice: (noticeRow?.value as string | null | undefined) ?? null,
      };
    }).subscribe({
      next: (value) => {
        setRows(value.list);
        setNotice(value.notice);
        setReady(true);
      },
      error: () => setReady(true),
    });

    return () => subscription.unsubscribe();
  }, []);

  const counts = useMemo(() => {
    const result = { pending: 0, failed: 0, conflict: 0, syncing: 0 };
    for (const row of rows) {
      if (row.status === "pending_sync") result.pending += 1;
      else if (row.status === "syncing") {
        result.pending += 1;
        result.syncing += 1;
      } else if (row.status === "sync_failed") result.failed += 1;
      else if (row.status === "conflict") result.conflict += 1;
    }
    return result;
  }, [rows]);

  return { rows, ready, notice, counts };
}