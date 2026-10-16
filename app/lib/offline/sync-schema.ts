import { z } from "zod";

export const SYNC_BATCH_MAX = 20;

export const CONFLICT_KINDS = [
  "stock_short",
  "price_changed",
  "inactive_product",
  "discount_over_limit",
  "clock_skew",
] as const;
export type ConflictKind = (typeof CONFLICT_KINDS)[number];

export const CONFLICT_LABEL: Record<ConflictKind, string> = {
  stock_short: "Stok tidak cukup",
  price_changed: "Harga berbeda",
  inactive_product: "Produk nonaktif",
  discount_over_limit: "Diskon melebihi batas",
  clock_skew: "Jam perangkat tidak wajar",
};

// Total dan harga beli sengaja tidak dikirim: server menghitung ulang.
export const syncSaleSchema = z
  .object({
    kind: z.literal("sale"),
    clientId: z.uuid(),
     storeId: z.uuid().nullish(),
    tempNo: z.string().trim().min(1).max(40),
    soldAt: z.iso.datetime(),
    cashierName: z.string().trim().max(100),
    items: z
      .array(
        z.object({
          variantId: z.uuid(),
          qty: z.number().int().min(1).max(10_000),
          unitPrice: z.number().int().min(0).max(1_000_000_000),
        }),
      )
      .min(1)
      .max(100),
    discount: z.object({
      type: z.enum(["none", "percent", "amount"]),
      value: z.number().int().min(0).max(1_000_000_000),
    }),
    cashReceived: z.number().int().min(0).max(2_000_000_000),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.items.forEach((item, index) => {
      if (seen.has(item.variantId)) {
        ctx.addIssue({
          code: "custom",
          message: "Produk ganda",
          path: ["items", index, "variantId"],
        });
      }
      seen.add(item.variantId);
    });
    if (value.discount.type === "percent" && value.discount.value > 100) {
      ctx.addIssue({
        code: "custom",
        message: "Diskon persen maksimal 100",
        path: ["discount", "value"],
      });
    }
  });

// Retur offline. Mengacu pada penjualan induk via clientId (penjualan yang
// juga dibuat offline) atau saleId langsung (sudah pernah tersinkron). Total
// refund dihitung server, tidak dipercaya dari klien.
export const syncReturnSchema = z
  .object({
    kind: z.literal("return"),
    clientId: z.uuid(),
    storeId: z.uuid().nullish(),
    saleClientId: z.uuid().optional(),
    saleId: z.uuid().optional(),
    lines: z
      .array(
        z.object({
          variantId: z.uuid(),
          qty: z.number().int().min(1).max(10_000),
        }),
      )
      .min(1)
      .max(100),
    reason: z.string().trim().min(3).max(200),
  })
  .superRefine((value, ctx) => {
    if (!value.saleClientId && !value.saleId) {
      ctx.addIssue({
        code: "custom",
        message: "Penjualan induk tidak ditentukan",
        path: ["saleId"],
      });
    }
    const seen = new Set<string>();
    value.lines.forEach((line, index) => {
      if (seen.has(line.variantId)) {
        ctx.addIssue({
          code: "custom",
          message: "Produk ganda",
          path: ["lines", index, "variantId"],
        });
      }
      seen.add(line.variantId);
    });
  });

// Satu batch mencampur penjualan dan retur; dibedakan lewat field `kind`.
export const syncItemSchema = z.discriminatedUnion("kind", [
  syncSaleSchema,
  syncReturnSchema,
]);

export const syncBatchSchema = z.object({
  sales: z.array(syncItemSchema).min(1).max(SYNC_BATCH_MAX),
});

export type SyncSaleInput = z.infer<typeof syncSaleSchema>;
export type SyncReturnInput = z.infer<typeof syncReturnSchema>;
export type SyncItemInput = z.infer<typeof syncItemSchema>;
export type SyncConflictInfo = { kind: ConflictKind; detail: string };

export type SyncResultItem =
  | {
      clientId: string;
      status: "created" | "duplicate";
      saleId: string;
      receiptNo: number;
      conflicts: SyncConflictInfo[];
    }
  // Retur yang penjualan induknya belum tiba: bukan kegagalan permanen,
  // dicoba lagi pada siklus sinkron berikutnya.
  | { clientId: string; status: "retry_later"; message: string }
  | { clientId: string; status: "rejected"; message: string };

export type SyncResponse = { results: SyncResultItem[] };