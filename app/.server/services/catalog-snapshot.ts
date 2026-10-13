import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { inventory, productVariants, products } from "../db/schema";
import { variantLabel } from "~/lib/format";
import type { CatalogSnapshot } from "~/lib/offline/types";

const MAX_ITEMS = 5000;

// Snapshot katalog untuk disimpan di perangkat kasir.
// Sengaja TIDAK memuat harga beli.
export async function getCatalogSnapshot(
  db: Db,
  opts: { businessId: string; storeId: string },
): Promise<CatalogSnapshot> {
  const rows = await db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      name: products.name,
      sku: productVariants.sku,
      barcode: productVariants.barcode,
      size: productVariants.size,
      color: productVariants.color,
      price: productVariants.sellPrice,
      qty: sql<number>`coalesce(${inventory.qty}, 0)`.mapWith(Number),
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(
      inventory,
      and(
        eq(inventory.variantId, productVariants.id),
        eq(inventory.storeId, opts.storeId),
      ),
    )
    .where(
      and(
        eq(productVariants.businessId, opts.businessId),
        eq(productVariants.isActive, true),
        eq(products.isActive, true),
      ),
    )
    .orderBy(asc(products.name), asc(productVariants.sku))
    .limit(MAX_ITEMS + 1);

  const truncated = rows.length > MAX_ITEMS;
  const limited = truncated ? rows.slice(0, MAX_ITEMS) : rows;

  const counts = new Map<string, number>();
  for (const row of limited) {
    counts.set(row.productId, (counts.get(row.productId) ?? 0) + 1);
  }

  return {
    generatedAt: new Date().toISOString(),
    storeId: opts.storeId,
    truncated,
    items: limited.map((row) => ({
      variantId: row.variantId,
      productId: row.productId,
      name: row.name,
      // Varian tanpa ukuran/warna memakai SKU agar tetap bisa dibedakan.
      label:
        variantLabel(row.size, row.color) ??
        ((counts.get(row.productId) ?? 0) > 1 ? row.sku : null),
      sku: row.sku,
      barcode: row.barcode,
      price: row.price,
      qty: row.qty,
    })),
  };
}