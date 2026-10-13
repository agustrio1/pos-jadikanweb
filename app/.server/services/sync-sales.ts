import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "~/.server/db/client";
import {
  inventory,
  offlineSales,
  payments,
  productVariants,
  products,
  saleConflicts,
  saleItems,
  sales,
  stockMovements,
  stores,
} from "~/.server/db/schema";
import { UserError } from "~/.server/errors";
import { formatReceiptNo, formatRupiah, variantLabel } from "~/lib/format";
import type {
  SyncConflictInfo,
  SyncResultItem,
  SyncSaleInput,
} from "~/lib/offline/sync-schema";

type Actor = {
  businessId: string;
  storeId: string;
  userId: string;
  role: "admin" | "kasir";
  maxDiscountPct: number;
};

type FoundConflict = SyncConflictInfo & { variantId: string | null };

const MAX_AMOUNT = 2_000_000_000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
// Transaksi offline wajar tertunda beberapa hari, tetapi lebih dari ini patut
// diperiksa (jam perangkat salah atau dimundurkan).
const MAX_OFFLINE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Mencatat satu penjualan dari outbox perangkat. Idempoten lewat unique index
// (store_id, client_id). Aturan yang tidak bisa dibatalkan (barang sudah
// keluar) menghasilkan flag konflik, bukan penolakan.
export async function syncSale(
  db: Db,
  actor: Actor,
  input: SyncSaleInput,
): Promise<SyncResultItem> {
  try {
    return await db.transaction(async (tx): Promise<SyncResultItem> => {
      // Kunci baris toko: menyerialkan penjualan per toko.
      const [store] = await tx
        .select({ last: stores.lastReceiptNo })
        .from(stores)
        .where(
          and(
            eq(stores.id, actor.storeId),
            eq(stores.businessId, actor.businessId),
          ),
        )
        .for("update");
      if (!store) throw new UserError("Toko tidak ditemukan.");

      const [existing] = await tx
        .select({ id: sales.id, receiptNo: sales.receiptNo })
        .from(sales)
        .where(
          and(
            eq(sales.storeId, actor.storeId),
            eq(sales.clientId, input.clientId),
          ),
        )
        .limit(1);
      if (existing) {
        const rows = await tx
          .select({ kind: saleConflicts.kind, detail: saleConflicts.detail })
          .from(saleConflicts)
          .where(eq(saleConflicts.saleId, existing.id));
        return {
          clientId: input.clientId,
          status: "duplicate",
          saleId: existing.id,
          receiptNo: existing.receiptNo,
          conflicts: rows,
        };
      }

      const ids = input.items.map((item) => item.variantId);

      const found = await tx
        .select({
          variantId: productVariants.id,
          sku: productVariants.sku,
          size: productVariants.size,
          color: productVariants.color,
          costPrice: productVariants.costPrice,
          sellPrice: productVariants.sellPrice,
          variantActive: productVariants.isActive,
          productActive: products.isActive,
          productName: products.name,
        })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(
          and(
            inArray(productVariants.id, ids),
            eq(productVariants.businessId, actor.businessId),
          ),
        );
      if (found.length !== ids.length) {
        throw new UserError(
          "Ada produk yang tidak ditemukan di bisnis ini. Transaksi tidak dapat dicatat otomatis.",
        );
      }
      const byId = new Map(found.map((row) => [row.variantId, row]));

      const stockRows = await tx
        .select({ variantId: inventory.variantId, qty: inventory.qty })
        .from(inventory)
        .where(
          and(
            eq(inventory.storeId, actor.storeId),
            inArray(inventory.variantId, ids),
          ),
        )
        .orderBy(asc(inventory.variantId))
        .for("update");
      const stockById = new Map(
        stockRows.map((row) => [row.variantId, row.qty]),
      );

      const conflicts: FoundConflict[] = [];

      const lines = input.items.map((item) => {
        const variant = byId.get(item.variantId);
        if (!variant) throw new UserError("Produk tidak ditemukan.");
        const label = variantLabel(variant.size, variant.color);
        const name = label
          ? `${variant.productName} (${label})`
          : variant.productName;
        const available = stockById.get(item.variantId) ?? 0;

        if (!variant.variantActive || !variant.productActive) {
          conflicts.push({
            kind: "inactive_product",
            variantId: item.variantId,
            detail: `${name} sudah dinonaktifkan di sistem.`,
          });
        }
        if (item.unitPrice !== variant.sellPrice) {
          const diffPct = Math.round(
            ((item.unitPrice - variant.sellPrice) / variant.sellPrice) * 100,
          );
          conflicts.push({
            kind: "price_changed",
            variantId: item.variantId,
            detail: `${name}: dijual ${formatRupiah(item.unitPrice)} di perangkat, harga sistem ${formatRupiah(variant.sellPrice)} (selisih ${diffPct > 0 ? "+" : ""}${diffPct}%).`,
          });
        }
        if (item.qty > available) {
          conflicts.push({
            kind: "stock_short",
            variantId: item.variantId,
            detail: `${name}: stok sistem ${available}, terjual ${item.qty} (stok menjadi ${available - item.qty}).`,
          });
        }

        return {
          ...item,
          ...variant,
          label,
          lineTotal: item.unitPrice * item.qty,
        };
      });

      const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
      if (subtotal > MAX_AMOUNT) {
        throw new UserError("Total transaksi terlalu besar.");
      }

      let discountAmount = 0;
      if (input.discount.type === "percent") {
        discountAmount = Math.floor((subtotal * input.discount.value) / 100);
      } else if (input.discount.type === "amount") {
        discountAmount = input.discount.value;
      }
      if (discountAmount > subtotal) {
        throw new UserError("Diskon melebihi subtotal.");
      }
      if (
        actor.role !== "admin" &&
        discountAmount * 100 > subtotal * actor.maxDiscountPct
      ) {
        conflicts.push({
          kind: "discount_over_limit",
          variantId: null,
          detail: `Diskon ${formatRupiah(discountAmount)} melebihi batas kewenangan ${actor.maxDiscountPct}%.`,
        });
      }

      const total = subtotal - discountAmount;
      if (input.cashReceived < total) {
        throw new UserError("Uang diterima kurang dari total.");
      }

      const now = new Date();
      let soldAt = new Date(input.soldAt);
      if (
        Number.isNaN(soldAt.getTime()) ||
        soldAt.getTime() > now.getTime() + CLOCK_SKEW_MS
      ) {
        conflicts.push({
          kind: "clock_skew",
          variantId: null,
          detail: `Waktu transaksi di perangkat (${input.soldAt}) tidak wajar. Dipakai waktu server.`,
        });
        soldAt = now;
      } else if (soldAt.getTime() < now.getTime() - MAX_OFFLINE_AGE_MS) {
        // Waktu perangkat tetap dipakai (transaksi memang bisa tertunda lama),
        // tetapi ditandai agar admin memeriksa jam perangkat.
        conflicts.push({
          kind: "clock_skew",
          variantId: null,
          detail: `Waktu transaksi di perangkat (${input.soldAt}) lebih dari 7 hari yang lalu. Waktu perangkat tetap dipakai; periksa apakah jam perangkat benar.`,
        });
      }

      const receiptNo = store.last + 1;

      const [sale] = await tx
        .insert(sales)
        .values({
          businessId: actor.businessId,
          storeId: actor.storeId,
          clientId: input.clientId,
          receiptNo,
          cashierId: actor.userId,
          subtotal,
          discountAmount,
          total,
          soldAt,
        })
        .returning({ id: sales.id });

      await tx.insert(saleItems).values(
        lines.map((line) => ({
          saleId: sale.id,
          variantId: line.variantId,
          productName: line.productName,
          sku: line.sku,
          variantLabel: line.label,
          qty: line.qty,
          unitPrice: line.unitPrice,
          costPrice: line.costPrice,
          lineTotal: line.lineTotal,
        })),
      );

      await tx.insert(payments).values({
        saleId: sale.id,
        method: "cash",
        amount: total,
        tendered: input.cashReceived,
        changeAmount: input.cashReceived - total,
      });

      // Stok boleh menjadi negatif; upsert menangani varian tanpa baris stok.
      for (const line of lines) {
        await tx
          .insert(inventory)
          .values({
            storeId: actor.storeId,
            variantId: line.variantId,
            qty: -line.qty,
          })
          .onConflictDoUpdate({
            target: [inventory.storeId, inventory.variantId],
            set: {
              qty: sql`${inventory.qty} - ${line.qty}`,
              updatedAt: new Date(),
            },
          });
      }

      await tx.insert(stockMovements).values(
        lines.map((line) => ({
          storeId: actor.storeId,
          variantId: line.variantId,
          delta: -line.qty,
          type: "sale" as const,
          reason: `Penjualan offline ${formatReceiptNo(receiptNo)} (${input.tempNo})`,
          refSaleId: sale.id,
          createdBy: actor.userId,
        })),
      );

      await tx
        .update(stores)
        .set({ lastReceiptNo: receiptNo })
        .where(eq(stores.id, actor.storeId));

      await tx.insert(offlineSales).values({
        saleId: sale.id,
        storeId: actor.storeId,
        tempNo: input.tempNo,
        deviceSoldAt: new Date(input.soldAt),
        deviceCashierName: input.cashierName || null,
      });

      if (conflicts.length > 0) {
        await tx.insert(saleConflicts).values(
          conflicts.map((c) => ({
            saleId: sale.id,
            storeId: actor.storeId,
            kind: c.kind,
            variantId: c.variantId,
            detail: c.detail,
          })),
        );
      }

      return {
        clientId: input.clientId,
        status: "created",
        saleId: sale.id,
        receiptNo,
        conflicts: conflicts.map(({ kind, detail }) => ({ kind, detail })),
      };
    });
  } catch (err) {
    if (err instanceof UserError) {
      return {
        clientId: input.clientId,
        status: "rejected",
        message: err.message,
      };
    }
    throw err;
  }
}

export async function listOpenConflicts(
  db: Db,
  opts: { storeId: string; limit?: number },
) {
  return db
    .select({
      id: saleConflicts.id,
      kind: saleConflicts.kind,
      detail: saleConflicts.detail,
      createdAt: saleConflicts.createdAt,
      saleId: saleConflicts.saleId,
      receiptNo: sales.receiptNo,
      tempNo: offlineSales.tempNo,
    })
    .from(saleConflicts)
    .innerJoin(sales, eq(sales.id, saleConflicts.saleId))
    .leftJoin(offlineSales, eq(offlineSales.saleId, saleConflicts.saleId))
    .where(
      and(
        eq(saleConflicts.storeId, opts.storeId),
        eq(saleConflicts.status, "open"),
      ),
    )
    .orderBy(desc(saleConflicts.createdAt))
    .limit(opts.limit ?? 100);
}

export async function resolveConflict(
  db: Db,
  opts: {
    storeId: string;
    conflictId: string;
    userId: string;
    note: string | null;
  },
): Promise<boolean> {
  const rows = await db
    .update(saleConflicts)
    .set({
      status: "resolved",
      resolvedBy: opts.userId,
      resolvedAt: new Date(),
      resolveNote: opts.note,
    })
    .where(
      and(
        eq(saleConflicts.id, opts.conflictId),
        eq(saleConflicts.storeId, opts.storeId),
        eq(saleConflicts.status, "open"),
      ),
    )
    .returning({ id: saleConflicts.id });
  return rows.length > 0;
}