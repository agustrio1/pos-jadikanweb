import { getDb } from "./db";

// Dipanggil saat logout: hapus data lokal dan cache halaman milik pengguna.
//
// Yang SENGAJA dipertahankan:
// - Transaksi outbox yang belum diterima server (pending_sync, syncing,
//   sync_failed). Menghapusnya berarti kehilangan penjualan.
// - deviceCode dan offlineSeq, agar nomor struk sementara tetap berurutan.
// Yang dihapus: katalog, identitas sesi, dan baris outbox yang sudah ada di
// server (synced, conflict) supaya pengguna berikutnya tidak melihatnya.
const KEEP_META_KEYS = ["deviceCode", "offlineSeq"];

export async function clearOfflineData(): Promise<void> {
  try {
    const db = getDb();
    await db.transaction("rw", db.catalog, db.meta, db.outbox, async () => {
      await db.catalog.clear();
      await db.meta.where("key").noneOf(KEEP_META_KEYS).delete();
      await db.outbox.where("status").anyOf("synced", "conflict").delete();
    });
  } catch {
    // IndexedDB tidak tersedia; tidak ada yang perlu dibersihkan.
  }

  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      registration?.active?.postMessage({ type: "CLEAR_PAGES" });
    }
  } catch {
    // abaikan
  }
}