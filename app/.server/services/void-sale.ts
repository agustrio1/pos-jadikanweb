import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  inventory,
  saleConflicts,
  saleItems,
  sales,
  stockMovements,
  stores,
  users,
} from "../db/schema";
import { UserError } from "../errors";
import { formatReceiptNo } from "~/lib/format";

type Actor = { businessId: string; storeId: string; userId: string };

// Membatalkan satu transaksi penuh. Idempoten: transaksi yang sudah batal
// tidak mengembalikan stok lagi. Urutan kunci (toko, lalu penjualan, lalu
// stok urut variantId) sama dengan createSale dan syncSale.
export async function voidSale(
  db: Db,
  actor: Actor,
  input: { saleId: string; reason: string },
): Promise<{ alreadyVoid: boolean }> {
  return db.transaction(async (tx) => {
    const [store] = await tx
      .select({ id: stores.id })
      .from(stores)
      .where(
        and(
          eq(stores.id, actor.storeId),
          eq(stores.businessId, actor.businessId),
        ),
      )
      .for("update");
    if (!store) throw new UserError("Toko tidak ditemukan.");

    const [sale] = await tx
      .select({ id: sales.id, receiptNo: sales.receiptNo, status: sales.status })
      .from(sales)
      .where(
        and(
          eq(sales.id, input.saleId),
          eq(sales.businessId, actor.businessId),
          eq(sales.storeId, actor.storeId),
        ),
      )
      .for("update");
    if (!sale) throw new UserError("Transaksi tidak ditemukan.");
    if (sale.status === "void") return { alreadyVoid: true };

    const items = await tx
      .select({ variantId: saleItems.variantId, qty: saleItems.qty })
      .from(saleItems)
      .where(eq(saleItems.saleId, sale.id))
      .orderBy(asc(saleItems.variantId));

    for (const item of items) {
      await tx
        .insert(inventory)
        .values({
          storeId: actor.storeId,
          variantId: item.variantId,
          qty: item.qty,
        })
        .onConflictDoUpdate({
          target: [inventory.storeId, inventory.variantId],
          set: {
            qty: sql`${inventory.qty} + ${item.qty}`,
            updatedAt: new Date(),
          },
        });
    }

    if (items.length > 0) {
      await tx.insert(stockMovements).values(
        items.map((item) => ({
          storeId: actor.storeId,
          variantId: item.variantId,
          delta: item.qty,
          type: "void" as const,
          reason: `Pembatalan ${formatReceiptNo(sale.receiptNo)}: ${input.reason}`,
          refSaleId: sale.id,
          createdBy: actor.userId,
        })),
      );
    }

    await tx
      .update(sales)
      .set({
        status: "void",
        voidedAt: new Date(),
        voidedBy: actor.userId,
        voidReason: input.reason,
      })
      .where(eq(sales.id, sale.id));

    // Konflik yang masih terbuka pada transaksi ini sudah tidak relevan.
    await tx
      .update(saleConflicts)
      .set({
        status: "resolved",
        resolvedBy: actor.userId,
        resolvedAt: new Date(),
        resolveNote: "Otomatis: transaksi dibatalkan.",
      })
      .where(
        and(
          eq(saleConflicts.saleId, sale.id),
          eq(saleConflicts.status, "open"),
        ),
      );

    return { alreadyVoid: false };
  });
}

export async function getVoidInfo(
  db: Db,
  opts: { businessId: string; storeId: string; saleId: string },
) {
  const [row] = await db
    .select({
      voidedAt: sales.voidedAt,
      voidReason: sales.voidReason,
      voidedByName: users.name,
    })
    .from(sales)
    .leftJoin(users, eq(users.id, sales.voidedBy))
    .where(
      and(
        eq(sales.id, opts.saleId),
        eq(sales.businessId, opts.businessId),
        eq(sales.storeId, opts.storeId),
      ),
    )
    .limit(1);
  return row ?? null;
}