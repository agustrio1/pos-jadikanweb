import { getDb } from "./db";

// Jumlah transaksi di perangkat yang belum diterima server.
// Baris "conflict" dan "synced" sudah tersimpan di server, jadi tidak dihitung.
export async function countUnsent(): Promise<number> {
  try {
    return await getDb()
      .outbox.where("status")
      .anyOf("pending_sync", "syncing", "sync_failed")
      .count();
  } catch {
    return 0;
  }
}