import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import {
  categories,
  inventory,
  productVariants,
  products,
  stockMovements,
} from "../db/schema";
import { UserError } from "../errors";
import type { ProductInput, VariantInput } from "~/lib/schemas";
import { formatRupiah, variantLabel } from "~/lib/format";
import { writeAudit } from "./audit";

type Actor = { businessId: string; storeId: string; userId: string };

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listCategories(db: Db, businessId: string) {
  return db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.businessId, businessId))
    .orderBy(asc(categories.name));
}

export async function createCategory(db: Db, businessId: string, name: string) {
  await db.insert(categories).values({ businessId, name });
}

export async function listVariants(
  db: Db,
  opts: {
    businessId: string;
    storeId: string;
    q?: string;
    low?: boolean;
    includeInactive?: boolean;
  },
) {
  const conditions = [eq(productVariants.businessId, opts.businessId)];

  if (!opts.includeInactive) {
    conditions.push(eq(productVariants.isActive, true));
    conditions.push(eq(products.isActive, true));
  }

  if (opts.q) {
    const like = `%${escapeLike(opts.q)}%`;
    const match = or(
      ilike(products.name, like),
      ilike(productVariants.sku, like),
      ilike(productVariants.barcode, like),
    );
    if (match) conditions.push(match);
  }

  if (opts.low) {
    conditions.push(
      sql`coalesce(${inventory.qty}, 0) <= coalesce(${inventory.minQty}, 0)`,
    );
  }

  return db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      productName: products.name,
      productActive: products.isActive,
      categoryName: categories.name,
      sku: productVariants.sku,
      barcode: productVariants.barcode,
      size: productVariants.size,
      color: productVariants.color,
      costPrice: productVariants.costPrice,
      sellPrice: productVariants.sellPrice,
      variantActive: productVariants.isActive,
      qty: sql<number>`coalesce(${inventory.qty}, 0)`.mapWith(Number),
      minQty: sql<number>`coalesce(${inventory.minQty}, 0)`.mapWith(Number),
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(
      inventory,
      and(
        eq(inventory.variantId, productVariants.id),
        eq(inventory.storeId, opts.storeId),
      ),
    )
    .where(and(...conditions))
    .orderBy(asc(products.name), asc(productVariants.sku))
    .limit(500);
}

export async function getProduct(
  db: Db,
  businessId: string,
  storeId: string,
  id: string,
) {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.businessId, businessId)))
    .limit(1);

  if (!product) return null;

  const variants = await db
    .select({
      id: productVariants.id,
      sku: productVariants.sku,
      barcode: productVariants.barcode,
      size: productVariants.size,
      color: productVariants.color,
      costPrice: productVariants.costPrice,
      sellPrice: productVariants.sellPrice,
      isDefault: productVariants.isDefault,
      isActive: productVariants.isActive,
      qty: sql<number>`coalesce(${inventory.qty}, 0)`.mapWith(Number),
      minQty: sql<number>`coalesce(${inventory.minQty}, 0)`.mapWith(Number),
    })
    .from(productVariants)
    .leftJoin(
      inventory,
      and(
        eq(inventory.variantId, productVariants.id),
        eq(inventory.storeId, storeId),
      ),
    )
    .where(eq(productVariants.productId, id))
    .orderBy(asc(productVariants.createdAt));

  return { product, variants };
}

async function insertVariant(
  tx: Tx,
  actor: Actor,
  productId: string,
  v: VariantInput,
  isDefault: boolean,
) {
  const [row] = await tx
    .insert(productVariants)
    .values({
      businessId: actor.businessId,
      productId,
      sku: v.sku,
      barcode: v.barcode,
      size: v.size,
      color: v.color,
      costPrice: v.costPrice,
      sellPrice: v.sellPrice,
      isDefault,
      isActive: v.isActive,
    })
    .returning({ id: productVariants.id });

  await tx.insert(inventory).values({
    storeId: actor.storeId,
    variantId: row.id,
    qty: v.initialStock,
    minQty: v.minQty,
  });

  if (v.initialStock > 0) {
    await tx.insert(stockMovements).values({
      storeId: actor.storeId,
      variantId: row.id,
      delta: v.initialStock,
      type: "initial",
      reason: "Stok awal",
      createdBy: actor.userId,
    });
  }
}

async function updateVariant(
  tx: Tx,
  actor: Actor,
  productId: string,
  variantId: string,
  v: VariantInput,
) {
  // Baca harga & label lama dulu supaya selisih harga bisa dijurnal.
  const [before] = await tx
    .select({
      sellPrice: productVariants.sellPrice,
      costPrice: productVariants.costPrice,
      size: productVariants.size,
      color: productVariants.color,
    })
    .from(productVariants)
    .where(
      and(
        eq(productVariants.id, variantId),
        eq(productVariants.businessId, actor.businessId),
      ),
    )
    .limit(1);
  if (!before) throw new UserError("Varian tidak ditemukan.");

  const [row] = await tx
    .update(productVariants)
    .set({
      sku: v.sku,
      barcode: v.barcode,
      size: v.size,
      color: v.color,
      costPrice: v.costPrice,
      sellPrice: v.sellPrice,
      isActive: v.isActive,
    })
    .where(
      and(
        eq(productVariants.id, variantId),
        eq(productVariants.productId, productId),
        eq(productVariants.businessId, actor.businessId),
      ),
    )
    .returning({ id: productVariants.id });

  if (!row) throw new UserError("Varian tidak ditemukan.");

  // Stok tidak diubah di sini, hanya batas minimum.
  await tx
    .insert(inventory)
    .values({
      storeId: actor.storeId,
      variantId: row.id,
      qty: 0,
      minQty: v.minQty,
    })
    .onConflictDoUpdate({
      target: [inventory.storeId, inventory.variantId],
      set: { minQty: v.minQty },
    });

  // Catat perubahan harga saja (bukan edit atribut lain) sebagai jejak audit.
  if (before.sellPrice !== v.sellPrice || before.costPrice !== v.costPrice) {
    const [prod] = await tx
      .select({ name: products.name })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    const label = variantLabel(before.size, before.color);
    const parts: string[] = [];
    if (before.sellPrice !== v.sellPrice) {
      parts.push(
        `harga jual ${formatRupiah(before.sellPrice)} → ${formatRupiah(v.sellPrice)}`,
      );
    }
    if (before.costPrice !== v.costPrice) {
      parts.push(
        `harga beli ${formatRupiah(before.costPrice)} → ${formatRupiah(v.costPrice)}`,
      );
    }
    await writeAudit(tx, {
      businessId: actor.businessId,
      storeId: actor.storeId,
      actorId: actor.userId,
      action: "price_change",
      entityType: "variant",
      entityId: variantId,
      detail: `Ubah harga ${prod?.name ?? "produk"}${label ? ` (${label})` : ""}: ${parts.join(", ")}`,
    });
  }
}

// Membuat (productId = null) atau memperbarui produk beserta variannya
// dalam satu transaksi.
export async function saveProduct(
  db: Db,
  actor: Actor,
  productId: string | null,
  input: ProductInput,
): Promise<string> {
  if (productId && !input.hasVariants && input.variants.some((v) => !v.id)) {
    throw new UserError("Produk tanpa varian tidak bisa ditambah varian.");
  }

  return db.transaction(async (tx) => {
    if (input.categoryId) {
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(
            eq(categories.id, input.categoryId),
            eq(categories.businessId, actor.businessId),
          ),
        )
        .limit(1);
      if (!category) throw new UserError("Kategori tidak ditemukan.");
    }

    let id: string;

    if (productId) {
      const [updated] = await tx
        .update(products)
        .set({
          name: input.name,
          categoryId: input.categoryId,
          isActive: input.isActive,
        })
        .where(
          and(
            eq(products.id, productId),
            eq(products.businessId, actor.businessId),
          ),
        )
        .returning({ id: products.id });
      if (!updated) throw new Response("Produk tidak ditemukan", { status: 404 });
      id = updated.id;
    } else {
      const [created] = await tx
        .insert(products)
        .values({
          businessId: actor.businessId,
          categoryId: input.categoryId,
          name: input.name,
          isActive: input.isActive,
        })
        .returning({ id: products.id });
      id = created.id;
    }

    for (const variant of input.variants) {
      if (variant.id) {
        await updateVariant(tx, actor, id, variant.id, variant);
      } else {
        await insertVariant(tx, actor, id, variant, !input.hasVariants);
      }
    }

    return id;
  });
}