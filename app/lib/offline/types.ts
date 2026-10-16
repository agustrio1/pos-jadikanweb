import { z } from "zod";
import type { ConflictKind } from "./sync-schema";

export const catalogItemSchema = z.object({
  variantId: z.string(),
  productId: z.string(),
  name: z.string(),
  label: z.string().nullable(),
  sku: z.string(),
  barcode: z.string().nullable(),
  price: z.number().int(),
  qty: z.number().int(),
});

export const catalogSnapshotSchema = z.object({
  generatedAt: z.string(),
  storeId: z.string(),
  truncated: z.boolean(),
  items: z.array(catalogItemSchema),
});

export type CatalogItem = z.infer<typeof catalogItemSchema>;
export type CatalogSnapshot = z.infer<typeof catalogSnapshotSchema>;

export type SessionUser = {
  name: string;
  role: "admin" | "kasir";
  storeId: string | null;
  // Opsional: data lama di perangkat belum memilikinya.
  maxDiscountPct?: number;
};

export type OutboxStatus =
  | "pending_sync"
  | "syncing"
  | "synced"
  | "conflict"
  | "sync_failed";

// Baris outbox bisa berupa penjualan atau retur. Baris lama tanpa field ini
// dianggap "sale".
export type OutboxKind = "sale" | "return";

export type OutboxItem = {
  variantId: string;
  name: string;
  sku: string;
  label: string | null;
  qty: number;
  unitPrice: number;
};

// Satu baris pembayaran untuk penjualan (campuran/non-tunai). Bila tidak ada,
// server memakai jalur lama tunai penuh dari cashReceived.
export type SalePaymentLine = {
  method: "cash" | "qris" | "debit" | "credit";
  amount: number;
  tendered?: number;
  reference?: string;
};

export type OutboxSale = {
  clientId: string; // kunci idempotensi, dibuat sekali dan tidak berubah
  kind?: OutboxKind; // default "sale" untuk baris lama
  // Khusus retur: merujuk penjualan induk. saleClientId untuk induk yang juga
  // dibuat offline; targetSaleId bila induk sudah pernah tersinkron.
  saleClientId?: string | null;
  targetSaleId?: string | null;
  reason?: string;
  tempNo: string;
  storeId: string | null;
  cashierName: string;
  soldAt: string; // ISO
  items: OutboxItem[];
  discount: { type: "none" | "percent" | "amount"; value: number };
  discountAmount: number;
  subtotal: number;
  total: number;
  cashReceived: number;
  change: number;
  // Rincian metode bila transaksi campuran/non-tunai. Baris lama tidak punya.
  payments?: SalePaymentLine[];
  status: OutboxStatus;
  attempts: number;
  nextRetryAt: number | null;
  syncingAt: number | null;
  lastError: string | null;
  permanent: boolean; // ditolak server: tidak dicoba otomatis
  saleId: string | null;
  receiptNo: number | null;
  conflicts: { kind: ConflictKind; detail: string }[];
  createdAt: number;
  syncedAt: string | null;
};