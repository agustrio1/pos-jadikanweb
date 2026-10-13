import { getDb } from "./db";
import { catalogSnapshotSchema } from "./types";

export type SyncResult =
  | { ok: true; count: number; at: string }
  | {
      ok: false;
      reason: "offline" | "auth" | "server" | "storage";
      message: string;
    };

let inflight: Promise<SyncResult> | null = null;

// Beberapa pemanggil sekaligus berbagi satu proses sinkronisasi.
export function syncCatalog(): Promise<SyncResult> {
  if (!inflight) {
    inflight = run().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

async function run(): Promise<SyncResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { ok: false, reason: "offline", message: "Perangkat sedang offline." };
  }

  let res: Response;
  try {
    res = await fetch("/api/catalog", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      reason: "offline",
      message: "Tidak dapat terhubung ke server.",
    };
  }

  if (res.redirected || res.status === 401 || res.status === 403) {
    return {
      ok: false,
      reason: "auth",
      message: "Sesi berakhir. Masuk ulang untuk memperbarui katalog.",
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      reason: "server",
      message: `Server menolak permintaan katalog (${res.status}).`,
    };
  }

  const body: unknown = await res.json().catch(() => null);
  const parsed = catalogSnapshotSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "server",
      message: "Format katalog dari server tidak valid.",
    };
  }
  const snapshot = parsed.data;

  try {
    const db = getDb();
    // Satu transaksi: kalau gagal di tengah, katalog lama tetap utuh.
    await db.transaction("rw", db.catalog, db.meta, async () => {
      await db.catalog.clear();
      await db.catalog.bulkPut(snapshot.items);
      await db.meta.put({ key: "catalogSyncedAt", value: snapshot.generatedAt });
      await db.meta.put({ key: "catalogStoreId", value: snapshot.storeId });
      await db.meta.put({ key: "catalogTruncated", value: snapshot.truncated });
    });
  } catch {
    return {
      ok: false,
      reason: "storage",
      message:
        "Gagal menyimpan katalog di perangkat (penyimpanan penuh atau diblokir).",
    };
  }

  return { ok: true, count: snapshot.items.length, at: snapshot.generatedAt };
}