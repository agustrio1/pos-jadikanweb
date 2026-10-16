import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  inventory,
  productVariants,
  products,
  purchaseOrderItems,
  purchaseOrders,
  stockMovements,
  suppliers,
  users,
} from "../db/schema";
import { UserError } from "../errors";
import { writeAudit } from "./audit";

type Actor = { businessId: string; storeId: string; userId: string };

// Nomor PO: berbasis waktu agar unik per toko tanpa bergantung pada penghitung
// (deletion tidak menyebabkan tabrakan nomor).
function buildPoNumber(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const y = now.getFullYear();
  const stamp = `${y}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(
    now.getHours(),
  )}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `PO-${stamp}`;
}

export async function listPurchaseOrders(db: Db, scope: { businessId: string; storeId: string }) {
  return db
    .select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      status: purchaseOrders.status,
      totalCost: purchaseOrders.totalCost,
      createdAt: purchaseOrders.createdAt,
      receivedAt: purchaseOrders.receivedAt,
      supplierName: suppliers.name,
      createdByName: users.name,
      itemCount:
        sql<number>`(select count(*)::int from ${purchaseOrderItems} where ${purchaseOrderItems.poId} = ${purchaseOrders.id})`.mapWith(
          Number,
        ),
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .leftJoin(users, eq(users.id, purchaseOrders.createdBy))
    .where(
      and(
        eq(purchaseOrders.businessId, scope.businessId),
        eq(purchaseOrders.storeId, scope.storeId),
      ),
    )
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(300);
}

export async function getPurchaseOrder(
  db: Db,
  scope: { businessId: string; id: string },
) {
  const [header] = await db
    .select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      status: purchaseOrders.status,
      totalCost: purchaseOrders.totalCost,
      note: purchaseOrders.note,
      createdAt: purchaseOrders.createdAt,
      receivedAt: purchaseOrders.receivedAt,
      supplierId: purchaseOrders.supplierId,
      supplierName: suppliers.name,
      createdByName: users.name,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .leftJoin(users, eq(users.id, purchaseOrders.createdBy))
    .where(
      and(
        eq(purchaseOrders.id, scope.id),
        eq(purchaseOrders.businessId, scope.businessId),
      ),
    )
    .limit(1);
  if (!header) return null;

  const items = await db
    .select({
      id: purchaseOrderItems.id,
      variantId: purchaseOrderItems.variantId,
      qty: purchaseOrderItems.qty,
      unitCost: purchaseOrderItems.unitCost,
      lineTotal: purchaseOrderItems.lineTotal,
      productName: products.name,
      sku: productVariants.sku,
      size: productVariants.size,
      color: productVariants.color,
    })
    .from(purchaseOrderItems)
    .innerJoin(
      productVariants,
      eq(productVariants.id, purchaseOrderItems.variantId),
    )
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(purchaseOrderItems.poId, header.id))
    .orderBy(products.name);

  return { ...header, items };
}

export async function createPurchaseOrder(
  db: Db,
  actor: Actor,
  input: {
    supplierId: string;
    note?: string | null;
    items: { variantId: string; qty: number; unitCost: number }[];
  },
): Promise<string> {
  return db.transaction(async (tx) => {
    // Pemasok harus milik bisnis ini.
    const [sup] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(
        and(
          eq(suppliers.id, input.supplierId),
          eq(suppliers.businessId, actor.businessId),
        ),
      )
      .limit(1);
    if (!sup) throw new UserError("Pemasok tidak ditemukan.");

    // Validasi semua varian milik bisnis dan hitung total di server.
    const rows: {
      variantId: string;
      qty: number;
      unitCost: number;
      lineTotal: number;
    }[] = [];
    let total = 0;
    for (const line of input.items) {
      const [v] = await tx
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(
          and(
            eq(productVariants.id, line.variantId),
            eq(productVariants.businessId, actor.businessId),
          ),
        )
        .limit(1);
      if (!v) throw new UserError("Salah satu varian tidak ditemukan.");
      const lineTotal = line.qty * line.unitCost;
      total += lineTotal;
      rows.push({ ...line, lineTotal });
    }
    if (rows.length === 0) throw new UserError("PO harus punya minimal satu item.");

    const now = new Date();
    const [po] = await tx
      .insert(purchaseOrders)
      .values({
        businessId: actor.businessId,
        storeId: actor.storeId,
        poNumber: buildPoNumber(now),
        supplierId: input.supplierId,
        status: "draft",
        totalCost: total,
        note: (input.note ?? "").trim().slice(0, 200) || null,
        createdBy: actor.userId,
      })
      .returning({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber });

    await tx.insert(purchaseOrderItems).values(
      rows.map((r) => ({
        poId: po.id,
        variantId: r.variantId,
        qty: r.qty,
        unitCost: r.unitCost,
        lineTotal: r.lineTotal,
      })),
    );

    return po.id;
  });
}

// Menerima PO draft: tambah stok, update harga pokok rata-rata tertimbang,
// catat movement `in`. Idempoten — hanya PO berstatus `draft` yang diproses.
export async function receivePurchaseOrder(
  db: Db,
  actor: Actor,
  poId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [po] = await tx
      .select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        status: purchaseOrders.status,
      })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.id, poId),
          eq(purchaseOrders.businessId, actor.businessId),
        ),
      )
      .limit(1)
      .for("update");
    if (!po) throw new UserError("PO tidak ditemukan.");
    if (po.status !== "draft")
      throw new UserError("PO ini sudah diproses sebelumnya.");

    const items = await tx
      .select({
        variantId: purchaseOrderItems.variantId,
        qty: purchaseOrderItems.qty,
        unitCost: purchaseOrderItems.unitCost,
      })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.poId, po.id));

    for (const item of items) {
      // Pastikan baris inventory ada lalu kunci untuk hindari balap.
      await tx
        .insert(inventory)
        .values({ storeId: actor.storeId, variantId: item.variantId, qty: 0 })
        .onConflictDoNothing();

      const [inv] = await tx
        .select({ qty: inventory.qty })
        .from(inventory)
        .where(
          and(
            eq(inventory.storeId, actor.storeId),
            eq(inventory.variantId, item.variantId),
          ),
        )
        .limit(1)
        .for("update");

      const [variant] = await tx
        .select({ costPrice: productVariants.costPrice })
        .from(productVariants)
        .where(eq(productVariants.id, item.variantId))
        .limit(1)
        .for("update");

      const qtyOld = inv?.qty ?? 0;
      const costOld = variant?.costPrice ?? 0;
      const qtyNew = qtyOld + item.qty;
      // Rata-rata tertimbang: (stok lama × pokok lama + masuk × pokok baru) / stok baru.
      const costNew =
        qtyNew > 0
          ? Math.round((qtyOld * costOld + item.qty * item.unitCost) / qtyNew)
          : item.unitCost;

      await tx
        .update(inventory)
        .set({ qty: qtyNew, updatedAt: new Date() })
        .where(
          and(
            eq(inventory.storeId, actor.storeId),
            eq(inventory.variantId, item.variantId),
          ),
        );

      await tx
        .update(productVariants)
        .set({ costPrice: costNew })
        .where(eq(productVariants.id, item.variantId));

      await tx.insert(stockMovements).values({
        storeId: actor.storeId,
        variantId: item.variantId,
        delta: item.qty,
        type: "in",
        reason: `Penerimaan PO ${po.poNumber}`,
        createdBy: actor.userId,
      });
    }

    await tx
      .update(purchaseOrders)
      .set({ status: "received", receivedAt: new Date() })
      .where(eq(purchaseOrders.id, po.id));

    await writeAudit(tx, {
      businessId: actor.businessId,
      storeId: actor.storeId,
      actorId: actor.userId,
      action: "stock_adjust",
      entityType: "purchase_order",
      entityId: po.id,
      detail: `Terima PO ${po.poNumber}: ${items.length} varian masuk stok, harga pokok diperbarui (rata-rata tertimbang).`,
    });
  });
}

// Batalkan PO draft (belum menerima stok).
export async function cancelPurchaseOrder(
  db: Db,
  actor: Actor,
  poId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [po] = await tx
      .select({ id: purchaseOrders.id, status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.id, poId),
          eq(purchaseOrders.businessId, actor.businessId),
        ),
      )
      .limit(1)
      .for("update");
    if (!po) throw new UserError("PO tidak ditemukan.");
    if (po.status !== "draft")
      throw new UserError("Hanya PO draft yang dapat dibatalkan.");

    await tx
      .update(purchaseOrders)
      .set({ status: "cancelled" })
      .where(eq(purchaseOrders.id, po.id));
  });
}
