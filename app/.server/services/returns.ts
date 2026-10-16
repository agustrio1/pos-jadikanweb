import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  inventory,
  saleItems,
  saleReturns,
  sales,
  stockMovements,
  stores,
  users,
} from "../db/schema";
import { UserError } from "../errors";
import { formatReceiptNo } from "~/lib/format";

type Actor = { businessId: string; storeId: string; userId: string };

// Membatalkan sebagian baris transaksi. Uang dikembalikan proporsional
// terhadap diskon: tiap baris menanggung bagian diskon sesuai bobot
// lineTotal/subtotal, baris terakhir menampung sisa pembulatan sehingga
// full retur persis sama dengan total yang dibayar.
// Urutan kunci (toko, lalu penjualan, lalu stok urut variantId) sama dengan
// createSale, syncSale, dan voidSale.
export async function returnSale(
  db: Db,
  actor: Actor,
  input: {
    saleId: string;
    lines: { variantId: string; qty: number }[];
    reason: string;
    // Hadir hanya saat retur datang dari antrean offline. Dipakai untuk
    // idempotensi: pengiriman ulang dengan clientId sama tidak dibuat dua kali.
    clientId?: string | null;
  },
): Promise<{ refundTotal: number; duplicate: boolean }> {
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
      .select({
        id: sales.id,
        receiptNo: sales.receiptNo,
        status: sales.status,
        subtotal: sales.subtotal,
        discountAmount: sales.discountAmount,
      })
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
    if (sale.status === "void") {
      throw new UserError(
        "Transaksi sudah dibatalkan. Tidak ada yang bisa diretur.",
      );
    }

    // Retur offline yang sama sudah pernah diterima? Bukan kesalahan, cukup
    // ulangi hasil tanpa mengubah stok.
    if (input.clientId) {
      const [seen] = await tx
        .select({ id: saleReturns.id })
        .from(saleReturns)
        .where(
          and(
            eq(saleReturns.saleId, sale.id),
            eq(saleReturns.clientId, input.clientId),
          ),
        )
        .limit(1);
      if (seen) return { refundTotal: 0, duplicate: true };
    }

    const soldItems = await tx
      .select({
        variantId: saleItems.variantId,
        productName: saleItems.productName,
        variantLabel: saleItems.variantLabel,
        qty: saleItems.qty,
        unitPrice: saleItems.unitPrice,
        lineTotal: saleItems.lineTotal,
      })
      .from(saleItems)
      .where(eq(saleItems.saleId, sale.id))
      .orderBy(asc(saleItems.variantId));
    const soldById = new Map(soldItems.map((row) => [row.variantId, row]));

    // Sisa yang masih bisa diretur per varian (menghitung retur sebelumnya).
    const returnedRows = await tx
      .select({
        variantId: saleReturns.variantId,
        returned: sql<number>`coalesce(sum(${saleReturns.qty}), 0)`.mapWith(Number),
      })
      .from(saleReturns)
      .where(eq(saleReturns.saleId, sale.id))
      .groupBy(saleReturns.variantId);
    const returnedById = new Map(
      returnedRows.map((row) => [row.variantId, row.returned]),
    );

    const lines = input.lines.map((line) => {
      const sold = soldById.get(line.variantId);
      if (!sold) throw new UserError("Produk tidak ada di transaksi ini.");
      const already = returnedById.get(line.variantId) ?? 0;
      const remaining = sold.qty - already;
      if (remaining <= 0) {
        throw new UserError(
          `"${sold.productName}" sudah diretur semua.`,
        );
      }
      if (line.qty > remaining) {
        throw new UserError(
          `"${sold.productName}" hanya tersisa ${remaining} untuk diretur.`,
        );
      }
      return { ...line, sold };
    });

    // Semua baris penuh? Arahkan ke pembatalan penuh supaya struk bertanda
    // void dan konflik ikut terselesaikan.
    const allFullyReturned = soldItems.every((row) => {
      const wanted =
        lines.find((line) => line.variantId === row.variantId)?.qty ?? 0;
      const already = returnedById.get(row.variantId) ?? 0;
      return row.qty - already - wanted <= 0;
    });
    if (allFullyReturned) {
      throw new UserError(
        "Seluruh item diretur. Gunakan pembatalan penuh agar transaksi ditandai batal.",
      );
    }

    // Alokasikan diskon ke SELURUH baris transaksi (bukan hanya yang diretur)
    // agar konsisten: tiap baris menanggung floor(D * lineTotal / subtotal),
    // baris terakhir (urut variantId) menampung sisa pembulatan sehingga
    // jumlah alokasi persis sama dengan discountAmount. Uang dibayar per baris
    // = lineTotal - alokasi; retur sebagian memakai pecahan qty terjual.
    const discountShare = new Map<string, number>();
    if (sale.subtotal > 0 && sale.discountAmount > 0) {
      let allocated = 0;
      const lastId = soldItems[soldItems.length - 1]?.variantId;
      for (const row of soldItems) {
        if (row.variantId === lastId) {
          discountShare.set(row.variantId, sale.discountAmount - allocated);
        } else {
          const share = Math.floor(
            (sale.discountAmount * row.lineTotal) / sale.subtotal,
          );
          allocated += share;
          discountShare.set(row.variantId, share);
        }
      }
    }

    const computed = lines.map((line) => {
      const share = discountShare.get(line.variantId) ?? 0;
      const paid = line.sold.lineTotal - share;
      const refund = Math.round((paid * line.qty) / line.sold.qty);
      return { ...line, refund };
    });

    const refundTotal = computed.reduce((sum, line) => sum + line.refund, 0);

    // Kembalikan stok per varian urut variantId (pola void).
    const byVariant = new Map<string, number>();
    for (const line of computed) {
      byVariant.set(
        line.variantId,
        (byVariant.get(line.variantId) ?? 0) + line.qty,
      );
    }
    const restock = [...byVariant.entries()].sort(([a], [b]) =>
      a < b ? -1 : 1,
    );

    for (const [variantId, qty] of restock) {
      await tx
        .insert(inventory)
        .values({ storeId: actor.storeId, variantId, qty })
        .onConflictDoUpdate({
          target: [inventory.storeId, inventory.variantId],
          set: { qty: sql`${inventory.qty} + ${qty}`, updatedAt: new Date() },
        });
    }

    const label = (row: { productName: string; variantLabel: string | null }) =>
      row.variantLabel ? `${row.productName} (${row.variantLabel})` : row.productName;

    await tx.insert(stockMovements).values(
      computed.map((line) => ({
        storeId: actor.storeId,
        variantId: line.variantId,
        delta: line.qty,
        type: "return" as const,
        reason: `Retur ${formatReceiptNo(sale.receiptNo)}: ${label(line.sold)} ×${line.qty} — ${input.reason}`,
        refSaleId: sale.id,
        createdBy: actor.userId,
      })),
    );

    await tx.insert(saleReturns).values(
      computed.map((line) => ({
        saleId: sale.id,
        storeId: actor.storeId,
        variantId: line.variantId,
        qty: line.qty,
        refundAmount: line.refund,
        reason: input.reason,
        createdBy: actor.userId,
        clientId: input.clientId ?? null,
      })),
    );

    return { refundTotal, duplicate: false };
  });
}

export async function listReturns(
  db: Db,
  opts: { businessId: string; storeId: string; saleId: string },
) {
  return db
    .select({
      id: saleReturns.id,
      variantId: saleReturns.variantId,
      qty: saleReturns.qty,
      refundAmount: saleReturns.refundAmount,
      reason: saleReturns.reason,
      createdAt: saleReturns.createdAt,
      productName: saleItems.productName,
      variantLabel: saleItems.variantLabel,
      sku: saleItems.sku,
      createdByName: users.name,
    })
    .from(saleReturns)
    .leftJoin(
      saleItems,
      and(
        eq(saleItems.saleId, saleReturns.saleId),
        eq(saleItems.variantId, saleReturns.variantId),
      ),
    )
    .leftJoin(users, eq(users.id, saleReturns.createdBy))
    .innerJoin(sales, eq(sales.id, saleReturns.saleId))
    .where(
      and(
        eq(sales.businessId, opts.businessId),
        eq(sales.storeId, opts.storeId),
        eq(saleReturns.saleId, opts.saleId),
      ),
    )
    .orderBy(asc(saleReturns.createdAt));
}
