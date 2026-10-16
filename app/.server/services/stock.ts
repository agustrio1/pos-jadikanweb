import { and, desc, eq, sql } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import {
  inventory,
  productVariants,
  products,
  stockMovements,
  users,
} from "../db/schema";
import { UserError } from "../errors";
import { variantLabel } from "~/lib/format";
import { writeAudit } from "./audit";

type Actor = { businessId: string; storeId: string; userId: string };

async function assertVariant(tx: Tx, businessId: string, variantId: string) {
  const [row] = await tx
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(
      and(
        eq(productVariants.id, variantId),
        eq(productVariants.businessId, businessId),
      ),
    )
    .limit(1);
  if (!row) throw new UserError("Varian tidak ditemukan.");
}

export async function stockIn(
  db: Db,
  actor: Actor,
  input: { variantId: string; qty: number; reason: string | null },
) {
  await db.transaction(async (tx) => {
    await assertVariant(tx, actor.businessId, input.variantId);

    await tx
      .insert(inventory)
      .values({
        storeId: actor.storeId,
        variantId: input.variantId,
        qty: input.qty,
      })
      .onConflictDoUpdate({
        target: [inventory.storeId, inventory.variantId],
        set: {
          qty: sql`${inventory.qty} + ${input.qty}`,
          updatedAt: new Date(),
        },
      });

    await tx.insert(stockMovements).values({
      storeId: actor.storeId,
      variantId: input.variantId,
      delta: input.qty,
      type: "in",
      reason: input.reason ?? "Stok masuk",
      createdBy: actor.userId,
    });
  });
}

// Mengatur stok ke jumlah hasil hitung fisik; selisihnya dicatat sebagai delta.
export async function stockAdjust(
  db: Db,
  actor: Actor,
  input: { variantId: string; qty: number; reason: string },
) {
  await db.transaction(async (tx) => {
    await assertVariant(tx, actor.businessId, input.variantId);

    await tx
      .insert(inventory)
      .values({
        storeId: actor.storeId,
        variantId: input.variantId,
        qty: 0,
      })
      .onConflictDoNothing();

    const [current] = await tx
      .select({ qty: inventory.qty })
      .from(inventory)
      .where(
        and(
          eq(inventory.storeId, actor.storeId),
          eq(inventory.variantId, input.variantId),
        ),
      )
      .for("update");

    const delta = input.qty - current.qty;
    if (delta === 0) return;

    await tx
      .update(inventory)
      .set({ qty: input.qty, updatedAt: new Date() })
      .where(
        and(
          eq(inventory.storeId, actor.storeId),
          eq(inventory.variantId, input.variantId),
        ),
      );

    await tx.insert(stockMovements).values({
      storeId: actor.storeId,
      variantId: input.variantId,
      delta,
      type: "adjust",
      reason: input.reason,
      createdBy: actor.userId,
    });

    const [v] = await tx
      .select({
        name: products.name,
        size: productVariants.size,
        color: productVariants.color,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(productVariants.id, input.variantId))
      .limit(1);
    const label = v
      ? `${v.name}${variantLabel(v.size, v.color) ? ` (${variantLabel(v.size, v.color)})` : ""}`
      : input.variantId;

    await writeAudit(tx, {
      businessId: actor.businessId,
      storeId: actor.storeId,
      actorId: actor.userId,
      action: "stock_adjust",
      entityType: "variant",
      entityId: input.variantId,
      detail: `Koreksi stok ${label}: ${current.qty} → ${input.qty} (${delta > 0 ? "+" : ""}${delta}). Alasan: ${input.reason}`,
    });
  });
}

export async function listMovements(
  db: Db,
  businessId: string,
  storeId: string,
  limit = 100,
) {
  return db
    .select({
      id: stockMovements.id,
      createdAt: stockMovements.createdAt,
      delta: stockMovements.delta,
      type: stockMovements.type,
      reason: stockMovements.reason,
      productName: products.name,
      size: productVariants.size,
      color: productVariants.color,
      sku: productVariants.sku,
      userName: users.name,
    })
    .from(stockMovements)
    .innerJoin(
      productVariants,
      eq(productVariants.id, stockMovements.variantId),
    )
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(users, eq(users.id, stockMovements.createdBy))
    .where(
      and(
        eq(stockMovements.storeId, storeId),
        eq(productVariants.businessId, businessId),
      ),
    )
    .orderBy(desc(stockMovements.createdAt))
    .limit(limit);
}