import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  inventory,
  productVariants,
  products,
  stockCountItems,
  stockCounts,
  stockMovements,
  users,
} from "../db/schema";
import { UserError } from "../errors";
import { variantLabel } from "~/lib/format";
import { writeAudit } from "./audit";

type Actor = { businessId: string; storeId: string; userId: string };

export async function listStockCounts(db: Db, scope: { businessId: string; storeId: string }) {
  return db
    .select({
      id: stockCounts.id,
      status: stockCounts.status,
      note: stockCounts.note,
      createdAt: stockCounts.createdAt,
      finalizedAt: stockCounts.finalizedAt,
      createdByName: users.name,
      itemCount:
        sql<number>`(select count(*)::int from ${stockCountItems} where ${stockCountItems.countId} = ${stockCounts.id})`.mapWith(
          Number,
        ),
    })
    .from(stockCounts)
    .leftJoin(users, eq(users.id, stockCounts.createdBy))
    .where(
      and(
        eq(stockCounts.businessId, scope.businessId),
        eq(stockCounts.storeId, scope.storeId),
      ),
    )
    .orderBy(desc(stockCounts.createdAt))
    .limit(200);
}

export async function getStockCount(
  db: Db,
  scope: { businessId: string; id: string },
) {
  const [header] = await db
    .select({
      id: stockCounts.id,
      status: stockCounts.status,
      note: stockCounts.note,
      createdAt: stockCounts.createdAt,
      finalizedAt: stockCounts.finalizedAt,
      createdByName: users.name,
    })
    .from(stockCounts)
    .leftJoin(users, eq(users.id, stockCounts.createdBy))
    .where(
      and(
        eq(stockCounts.id, scope.id),
        eq(stockCounts.businessId, scope.businessId),
      ),
    )
    .limit(1);
  if (!header) return null;

  const items = await db
    .select({
      id: stockCountItems.id,
      variantId: stockCountItems.variantId,
      expectedQty: stockCountItems.expectedQty,
      countedQty: stockCountItems.countedQty,
      delta: stockCountItems.delta,
      productName: products.name,
      sku: productVariants.sku,
      size: productVariants.size,
      color: productVariants.color,
    })
    .from(stockCountItems)
    .innerJoin(
      productVariants,
      eq(productVariants.id, stockCountItems.variantId),
    )
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(stockCountItems.countId, header.id))
    .orderBy(products.name);

  return { ...header, items };
}

export async function createStockCount(
  db: Db,
  actor: Actor,
  input: { note?: string | null },
): Promise<string> {
  const [row] = await db
    .insert(stockCounts)
    .values({
      businessId: actor.businessId,
      storeId: actor.storeId,
      status: "open",
      note: (input.note ?? "").trim().slice(0, 200) || null,
      createdBy: actor.userId,
    })
    .returning({ id: stockCounts.id });
  return row.id;
}

// Isi/perbarui satu baris hitung. expectedQty diambil sebagai snapshot stok
// saat baris pertama dibuat; pada perubahan berikutnya expectedQty dipertahankan.
export async function setStockCountItem(
  db: Db,
  actor: Actor,
  input: { countId: string; variantId: string; countedQty: number },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [count] = await tx
      .select({ id: stockCounts.id, status: stockCounts.status })
      .from(stockCounts)
      .where(
        and(
          eq(stockCounts.id, input.countId),
          eq(stockCounts.businessId, actor.businessId),
        ),
      )
      .limit(1);
    if (!count) throw new UserError("Dokumen opname tidak ditemukan.");
    if (count.status !== "open")
      throw new UserError("Opname sudah difinalisasi/dibatalkan.");

    const [variant] = await tx
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(
        and(
          eq(productVariants.id, input.variantId),
          eq(productVariants.businessId, actor.businessId),
        ),
      )
      .limit(1);
    if (!variant) throw new UserError("Varian tidak ditemukan.");

    const [inv] = await tx
      .select({ qty: inventory.qty })
      .from(inventory)
      .where(
        and(
          eq(inventory.storeId, actor.storeId),
          eq(inventory.variantId, input.variantId),
        ),
      )
      .limit(1);
    const expected = inv?.qty ?? 0;
    const counted = input.countedQty;

    await tx
      .insert(stockCountItems)
      .values({
        countId: input.countId,
        variantId: input.variantId,
        expectedQty: expected,
        countedQty: counted,
        delta: counted - expected,
      })
      .onConflictDoUpdate({
        target: [stockCountItems.countId, stockCountItems.variantId],
        set: {
          countedQty: counted,
          // delta dihitung terhadap expectedQty yang tersimpan (bukan snapshot baru).
          delta: sql`${counted} - ${stockCountItems.expectedQty}`,
        },
      });
  });
}

// Finalisasi: terapkan setiap selisih sebagai koreksi stok (movement `adjust`).
export async function finalizeStockCount(
  db: Db,
  actor: Actor,
  countId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [count] = await tx
      .select({ id: stockCounts.id, status: stockCounts.status })
      .from(stockCounts)
      .where(
        and(
          eq(stockCounts.id, countId),
          eq(stockCounts.businessId, actor.businessId),
        ),
      )
      .limit(1)
      .for("update");
    if (!count) throw new UserError("Dokumen opname tidak ditemukan.");
    if (count.status !== "open")
      throw new UserError("Opname sudah diproses sebelumnya.");

    const items = await tx
      .select({
        variantId: stockCountItems.variantId,
        expectedQty: stockCountItems.expectedQty,
        countedQty: stockCountItems.countedQty,
        delta: stockCountItems.delta,
        productName: products.name,
        size: productVariants.size,
        color: productVariants.color,
      })
      .from(stockCountItems)
      .innerJoin(
        productVariants,
        eq(productVariants.id, stockCountItems.variantId),
      )
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(stockCountItems.countId, count.id));

    let adjusted = 0;
    for (const item of items) {
      if (item.delta === 0) continue;
      adjusted += 1;

      // Stok fisik hasil opname menjadi kebenaran: set ke countedQty.
      await tx
        .insert(inventory)
        .values({
          storeId: actor.storeId,
          variantId: item.variantId,
          qty: item.countedQty,
        })
        .onConflictDoUpdate({
          target: [inventory.storeId, inventory.variantId],
          set: { qty: item.countedQty, updatedAt: new Date() },
        });

      await tx.insert(stockMovements).values({
        storeId: actor.storeId,
        variantId: item.variantId,
        delta: item.delta,
        type: "adjust",
        reason: "Opname (hitung fisik)",
        createdBy: actor.userId,
      });

      const label = variantLabel(item.size, item.color);
      await writeAudit(tx, {
        businessId: actor.businessId,
        storeId: actor.storeId,
        actorId: actor.userId,
        action: "stock_adjust",
        entityType: "variant",
        entityId: item.variantId,
        detail: `Opname: ${item.productName}${label ? ` (${label})` : ""} ${item.expectedQty} → ${item.countedQty} (${item.delta > 0 ? "+" : ""}${item.delta}).`,
      });
    }

    await tx
      .update(stockCounts)
      .set({ status: "finalized", finalizedAt: new Date() })
      .where(eq(stockCounts.id, count.id));
  });
}

export async function cancelStockCount(
  db: Db,
  actor: Actor,
  countId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [count] = await tx
      .select({ id: stockCounts.id, status: stockCounts.status })
      .from(stockCounts)
      .where(
        and(
          eq(stockCounts.id, countId),
          eq(stockCounts.businessId, actor.businessId),
        ),
      )
      .limit(1)
      .for("update");
    if (!count) throw new UserError("Dokumen opname tidak ditemukan.");
    if (count.status !== "open")
      throw new UserError("Hanya opname berstatus terbuka yang dapat dibatalkan.");

    await tx
      .update(stockCounts)
      .set({ status: "cancelled" })
      .where(eq(stockCounts.id, count.id));
  });
}
