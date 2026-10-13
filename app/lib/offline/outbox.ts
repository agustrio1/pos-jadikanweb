import { getDb } from "./db";
import type { OutboxItem, OutboxSale } from "./types";

const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export type NewOfflineSale = {
  // Dipakai ulang saat pembayaran online terputus di tengah jalan, supaya
  // server mengenali transaksi yang sama (idempotensi) dan tidak mencatat ganda.
  clientId?: string;
  storeId: string | null;
  cashierName: string;
  items: OutboxItem[];
  discount: OutboxSale["discount"];
  discountAmount: number;
  subtotal: number;
  total: number;
  cashReceived: number;
};

// Satu transaksi IndexedDB: nomor sementara dan baris outbox tersimpan bersama
// atau tidak sama sekali. clientId dibuat di sini, sekali, dan tidak diubah lagi.
export async function saveOfflineSale(
  input: NewOfflineSale,
): Promise<OutboxSale> {
  const db = getDb();
  return db.transaction("rw", db.meta, db.outbox, async () => {
    if (input.clientId) {
      const existing = await db.outbox.get(input.clientId);
      if (existing) return existing;
    }

    const codeRow = await db.meta.get("deviceCode");
    let code = codeRow?.value as string | undefined;
    if (!code) {
      code = crypto.randomUUID().slice(0, 4).toUpperCase();
      await db.meta.put({ key: "deviceCode", value: code });
    }
    const seqRow = await db.meta.get("offlineSeq");
    const seq = ((seqRow?.value as number | undefined) ?? 0) + 1;
    await db.meta.put({ key: "offlineSeq", value: seq });

    const now = Date.now();
    const row: OutboxSale = {
      clientId: input.clientId ?? crypto.randomUUID(),
      tempNo: `OFF-${code}-${String(seq).padStart(4, "0")}`,
      storeId: input.storeId,
      cashierName: input.cashierName,
      soldAt: new Date(now).toISOString(),
      items: input.items,
      discount: input.discount,
      discountAmount: input.discountAmount,
      subtotal: input.subtotal,
      total: input.total,
      cashReceived: input.cashReceived,
      change: input.cashReceived - input.total,
      status: "pending_sync",
      attempts: 0,
      nextRetryAt: null,
      syncingAt: null,
      lastError: null,
      permanent: false,
      saleId: null,
      receiptNo: null,
      conflicts: [],
      createdAt: now,
      syncedAt: null,
    };
    await db.outbox.add(row);
    return row;
  });
}

// Mengizinkan percobaan ulang untuk transaksi yang gagal/ditolak.
export async function retryOne(clientId: string): Promise<void> {
  const db = getDb();
  const row = await db.outbox.get(clientId);
  if (!row || row.status !== "sync_failed") return;
  await db.outbox.update(clientId, {
    status: "pending_sync",
    permanent: false,
    attempts: 0,
    nextRetryAt: null,
    lastError: null,
  });
}

// Hanya baris yang sudah dikonfirmasi server (synced) dan berumur > 30 hari.
// Baris conflict dan sync_failed tidak pernah dihapus otomatis.
export async function pruneSynced(): Promise<void> {
  const db = getDb();
  const cutoff = Date.now() - PRUNE_AFTER_MS;
  await db.outbox
    .where("status")
    .equals("synced")
    .filter((row) => row.createdAt < cutoff)
    .delete();
}