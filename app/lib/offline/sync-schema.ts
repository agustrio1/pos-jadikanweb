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

export const syncBatchSchema = z.object({
  sales: z.array(syncSaleSchema).min(1).max(SYNC_BATCH_MAX),
});

export type SyncSaleInput = z.infer<typeof syncSaleSchema>;
export type SyncConflictInfo = { kind: ConflictKind; detail: string };

export type SyncResultItem =
  | {
      clientId: string;
      status: "created" | "duplicate";
      saleId: string;
      receiptNo: number;
      conflicts: SyncConflictInfo[];
    }
  | { clientId: string; status: "rejected"; message: string };

export type SyncResponse = { results: SyncResultItem[] };