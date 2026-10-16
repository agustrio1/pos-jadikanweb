import { syncCatalog } from "./catalog-sync";
import { getDb, type PosDatabase } from "./db";
import { pruneSynced } from "./outbox";
import {
  SYNC_BATCH_MAX,
  type SyncResponse,
  type SyncResultItem,
} from "./sync-schema";
import type { OutboxSale } from "./types";

const REQUEST_TIMEOUT_MS = 20_000;
const STALE_SYNCING_MS = 60_000;
const MAX_AUTO_ATTEMPTS = 5;
const NOTICE_KEY = "syncNotice";

export type FlushOptions = { manual?: boolean };
export type FlushResult =
  | { ok: true; sent: number }
  | { ok: false; message: string };

type SendOutcome =
  | { kind: "ok"; results: SyncResultItem[] }
  | { kind: "blocked" | "bad" | "retry"; message: string };

let running = false;

// Aman dipanggil dari mana saja. Web Locks mencegah dua tab mengirim bersamaan;
// kalau tidak didukung, dipakai penanda dalam memori (per tab). Server tetap
// idempoten sehingga kiriman ganda tidak membuat penjualan ganda.
export async function flushOutbox(
  opts: FlushOptions = {},
): Promise<FlushResult> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    const result = await navigator.locks.request(
      "pos-outbox-sync",
      { ifAvailable: true },
      async (lock) => (lock ? run(opts) : null),
    );
    return result ?? { ok: true, sent: 0 };
  }
  if (running) return { ok: true, sent: 0 };
  running = true;
  try {
    return await run(opts);
  } finally {
    running = false;
  }
}

async function run(opts: FlushOptions): Promise<FlushResult> {
  if (!navigator.onLine) {
    return { ok: false, message: "Perangkat sedang offline." };
  }

  let db: PosDatabase;
  try {
    db = getDb();
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error ? err.message : "Penyimpanan lokal tidak tersedia.",
    };
  }

  // Pulihkan transaksi yang menggantung di "syncing" (tab ditutup, koneksi putus).
  const now = Date.now();
  await db.outbox
    .where("status")
    .equals("syncing")
    .filter((row) => now - (row.syncingAt ?? 0) > STALE_SYNCING_MS)
    .modify({ status: "pending_sync", syncingAt: null });

  // Hanya kirim transaksi milik toko akun yang sedang login. Identitas
  // disimpan di meta oleh layout setelah login; sebelum itu tidak ada yang dikirim.
  const userRow = await db.meta.get("user");
  const currentStore =
    (userRow?.value as { storeId?: string | null } | undefined)?.storeId ??
    null;
  if (!currentStore) return { ok: true, sent: 0 };

  const candidates = await db.outbox
    .where("status")
    .anyOf("pending_sync", "sync_failed")
    .sortBy("createdAt");
  const due = candidates.filter(
    (row) =>
      !row.permanent &&
      (row.storeId === null || row.storeId === currentStore) &&
      // Setelah MAX_AUTO_ATTEMPTS gagal, baris berstatus sync_failed hanya
      // dicoba lagi lewat tombol manual.
      (row.status !== "sync_failed" || opts.manual) &&
      (opts.manual || (row.nextRetryAt ?? 0) <= now),
  );
  if (due.length === 0) return { ok: true, sent: 0 };

  let sent = 0;
  let failure: string | null = null;

  for (let i = 0; i < due.length && !failure; i += SYNC_BATCH_MAX) {
    const chunk = due.slice(i, i + SYNC_BATCH_MAX);

    await db.transaction("rw", db.outbox, async () => {
      for (const row of chunk) {
        await db.outbox.update(row.clientId, {
          status: "syncing",
          syncingAt: Date.now(),
        });
      }
    });

    const outcome = await send(chunk);

    if (outcome.kind === "ok") {
      sent += await applyResults(db, chunk, outcome.results);
      await setNotice(db, null);
    } else if (outcome.kind === "bad" && chunk.length > 1) {
      // Server memvalidasi satu batch sekaligus, jadi satu transaksi cacat
      // membuat seluruh batch ditolak. Kirim satu per satu agar transaksi yang
      // valid tidak ikut dinyatakan gagal.
      const result = await sendIndividually(db, chunk);
      sent += result.sent;
      failure = result.failure;
      await setNotice(db, result.failure);
    } else {
      failure = outcome.message;
      await applyFailure(db, chunk, outcome.kind, outcome.message);
      await setNotice(db, outcome.message);
    }
  }

  if (sent > 0) {
    // Stok di server sudah berubah; segarkan katalog lokal.
    void syncCatalog();
    void pruneSynced().catch(() => {});
  }

  return failure ? { ok: false, message: failure } : { ok: true, sent };
}

// Semua baris di chunk masih berstatus "syncing" ketika fungsi ini dipanggil.
async function sendIndividually(
  db: PosDatabase,
  chunk: OutboxSale[],
): Promise<{ sent: number; failure: string | null }> {
  let sent = 0;

  for (let i = 0; i < chunk.length; i++) {
    const row = chunk[i];
    const outcome = await send([row]);

    if (outcome.kind === "ok") {
      sent += await applyResults(db, [row], outcome.results);
      continue;
    }

    const kind = outcome.kind;
    if (kind === "bad") {
      // Hanya baris ini yang cacat.
      await applyFailure(db, [row], "bad", outcome.message);
      continue;
    }

    // Sesi habis atau koneksi terputus: hentikan, kembalikan sisa baris ke antrean.
    await applyFailure(db, chunk.slice(i), kind, outcome.message);
    return { sent, failure: outcome.message };
  }

  return { sent, failure: null };
}

function toPayload(row: OutboxSale) {
  if (row.kind === "return") {
    return {
      kind: "return" as const,
      clientId: row.clientId,
      storeId: row.storeId,
      saleClientId: row.saleClientId ?? undefined,
      saleId: row.targetSaleId ?? undefined,
      lines: row.items.map(({ variantId, qty }) => ({ variantId, qty })),
      reason: row.reason ?? "Retur offline",
    };
  }
  return {
    kind: "sale" as const,
    clientId: row.clientId,
    storeId: row.storeId,
    tempNo: row.tempNo,
    soldAt: row.soldAt,
    cashierName: row.cashierName,
    items: row.items.map(({ variantId, qty, unitPrice }) => ({
      variantId,
      qty,
      unitPrice,
    })),
    discount: row.discount,
    cashReceived: row.cashReceived,
    // Hanya ada bila transaksi campuran/non-tunai; undefined dihapus saat JSON.
    payments: row.payments,
  };
}

async function send(chunk: OutboxSale[]): Promise<SendOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      signal: controller.signal,
      body: JSON.stringify({ sales: chunk.map(toPayload) }),
    });

    if (res.status === 401) {
      return {
        kind: "blocked",
        message: "Sesi berakhir. Login ulang, lalu sinkronkan kembali.",
      };
    }
    if (res.status === 403) {
      return {
        kind: "blocked",
        message: "Akun ini tidak diizinkan menyinkronkan transaksi.",
      };
    }
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      return {
        kind: "bad",
        message: `Ditolak server: ${body?.error ?? "data tidak valid."}`,
      };
    }
    if (res.status === 409) {
      return {
        kind: "blocked",
        message:
          "Antrean berisi transaksi toko lain. Login dengan akun toko yang sesuai.",
      };
    }
    if (!res.ok) {
      return { kind: "retry", message: `Server bermasalah (${res.status}).` };
    }

    const data = (await res.json()) as Partial<SyncResponse>;
    if (!Array.isArray(data.results)) {
      return { kind: "retry", message: "Respons server tidak dikenali." };
    }
    return { kind: "ok", results: data.results };
  } catch {
    // Jaringan putus, timeout, atau balasan bukan JSON (mis. captive portal).
    return { kind: "retry", message: "Koneksi ke server terputus." };
  } finally {
    clearTimeout(timer);
  }
}

// Status akhir ditulis hanya setelah server mengonfirmasi hasilnya.
async function applyResults(
  db: PosDatabase,
  chunk: OutboxSale[],
  results: SyncResultItem[],
): Promise<number> {
  const byId = new Map(results.map((r) => [r.clientId, r]));
  let accepted = 0;

  await db.transaction("rw", db.outbox, async () => {
    for (const row of chunk) {
      const result = byId.get(row.clientId);

      if (!result) {
        await db.outbox.update(
          row.clientId,
          retryPatch(row, "Respons server tidak lengkap."),
        );
        continue;
      }

      if (result.status === "retry_later") {
        // Penjualan induk belum tiba: kirim lagi nanti, jangan tandai permanen.
        await db.outbox.update(
          row.clientId,
          retryPatch(row, result.message),
        );
        continue;
      }

      if (result.status === "rejected") {
        await db.outbox.update(row.clientId, {
          status: "sync_failed",
          permanent: true,
          attempts: row.attempts + 1,
          nextRetryAt: null,
          syncingAt: null,
          lastError: result.message,
        });
        continue;
      }

      accepted += 1;
      await db.outbox.update(row.clientId, {
        status: result.conflicts.length > 0 ? "conflict" : "synced",
        saleId: result.saleId,
        receiptNo: result.receiptNo,
        conflicts: result.conflicts,
        syncedAt: new Date().toISOString(),
        syncingAt: null,
        nextRetryAt: null,
        permanent: false,
        lastError: null,
      });
    }
  });

  return accepted;
}

function retryPatch(row: OutboxSale, message: string): Partial<OutboxSale> {
  const attempts = row.attempts + 1;
  return {
    status: attempts >= MAX_AUTO_ATTEMPTS ? "sync_failed" : "pending_sync",
    permanent: false,
    attempts,
    nextRetryAt: Date.now() + Math.min(5_000 * 2 ** row.attempts, 300_000),
    syncingAt: null,
    lastError: message,
  };
}

async function applyFailure(
  db: PosDatabase,
  chunk: OutboxSale[],
  kind: "blocked" | "bad" | "retry",
  message: string,
): Promise<void> {
  await db.transaction("rw", db.outbox, async () => {
    for (const row of chunk) {
      if (kind === "blocked") {
        await db.outbox.update(row.clientId, {
          status: "pending_sync",
          syncingAt: null,
        });
      } else if (kind === "bad") {
        await db.outbox.update(row.clientId, {
          status: "sync_failed",
          permanent: true,
          attempts: row.attempts + 1,
          nextRetryAt: null,
          syncingAt: null,
          lastError: message,
        });
      } else {
        await db.outbox.update(row.clientId, retryPatch(row, message));
      }
    }
  });
}

async function setNotice(db: PosDatabase, value: string | null) {
  const current = await db.meta.get(NOTICE_KEY);
  if (((current?.value as string | null | undefined) ?? null) === value) return;
  await db.meta.put({ key: NOTICE_KEY, value });
}