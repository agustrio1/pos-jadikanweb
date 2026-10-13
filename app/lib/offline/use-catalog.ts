import { liveQuery } from "dexie";
import { useCallback, useEffect, useState } from "react";
import { syncCatalog, type SyncResult } from "./catalog-sync";
import { getDb } from "./db";
import type { CatalogItem } from "./types";
import { useOnline } from "./use-online";

const AUTO_SYNC_MS = 5 * 60 * 1000;

export function useCatalog() {
  const online = useOnline();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [ready, setReady] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  // Baca katalog dari IndexedDB dan ikuti perubahannya.
  useEffect(() => {
    let db: ReturnType<typeof getDb>;
    try {
      db = getDb();
    } catch (err) {
      setStorageError(
        err instanceof Error ? err.message : "Penyimpanan lokal tidak tersedia.",
      );
      setReady(true);
      return;
    }

    const subscription = liveQuery(async () => {
      const [rows, synced, trunc] = await Promise.all([
        db.catalog.toArray(),
        db.meta.get("catalogSyncedAt"),
        db.meta.get("catalogTruncated"),
      ]);
      rows.sort(
        (a, b) =>
          a.name.localeCompare(b.name, "id") || a.sku.localeCompare(b.sku, "id"),
      );
      return {
        rows,
        syncedAt: (synced?.value as string | undefined) ?? null,
        truncated: trunc?.value === true,
      };
    }).subscribe({
      next: (value) => {
        setItems(value.rows);
        setSyncedAt(value.syncedAt);
        setTruncated(value.truncated);
        setReady(true);
      },
      error: (err) => {
        setStorageError(
          err instanceof Error ? err.message : "Gagal membaca penyimpanan lokal.",
        );
        setReady(true);
      },
    });

    return () => subscription.unsubscribe();
  }, []);

  const sync = useCallback(async (): Promise<SyncResult> => {
    setSyncing(true);
    const result = await syncCatalog();
    setSyncing(false);
    setError(result.ok ? null : result.message);
    return result;
  }, []);

  // Sinkron saat halaman dibuka dan setiap kali koneksi kembali.
  useEffect(() => {
    if (online) void sync();
  }, [online, sync]);

  // Sinkron berkala selama halaman terbuka.
  useEffect(() => {
    const id = setInterval(() => {
      if (navigator.onLine) void sync();
    }, AUTO_SYNC_MS);
    return () => clearInterval(id);
  }, [sync]);

  return {
    items,
    ready,
    online,
    syncedAt,
    truncated,
    syncing,
    error,
    storageError,
    sync,
  };
}