import { and, eq, ilike, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  productVariants,
  products,
  purchaseOrders,
  saleItems,
  sales,
  suppliers,
  customers,
} from "../db/schema";
import { variantLabel } from "~/lib/format";

// Satu hasil pencarian lintas entitas, siap dirender command palette.
export type SearchItem = { to: string; title: string; subtitle: string };
export type SearchGroup = { type: string; label: string; items: SearchItem[] };

type Opts = {
  businessId: string;
  storeId: string;
  q: string;
  role: "admin" | "kasir";
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

// Pencarian global lintas data: produk, penjualan, pelanggan (semua peran),
// ditambah pemasok & pembelian (khusus admin). Setiap grup dibatasi beberapa
// hasil agar daftar tetap ringkas.
export async function globalSearch(db: Db, opts: Opts): Promise<SearchGroup[]> {
  const { businessId, storeId, role } = opts;
  const q = opts.q.trim();
  if (q.length < 2) return [];
  const like = `%${escapeLike(q)}%`;
  const groups: SearchGroup[] = [];

  // --- Produk & varian ------------------------------------------------------
  const productRows = await db
    .select({
      productId: products.id,
      name: products.name,
      sku: productVariants.sku,
      size: productVariants.size,
      color: productVariants.color,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        eq(productVariants.businessId, businessId),
        or(
          ilike(products.name, like),
          ilike(productVariants.sku, like),
          ilike(productVariants.barcode, like),
        ),
      ),
    )
    .limit(6);
  if (productRows.length) {
    groups.push({
      type: "produk",
      label: "Produk",
      items: productRows.map((r) => ({
        to: `/produk/${r.productId}`,
        title: r.name,
        subtitle: [variantLabel(r.size, r.color), r.sku].filter(Boolean).join(" · "),
      })),
    });
  }

  // --- Penjualan (nomor struk atau nama produk terjual) ---------------------
  const saleRows = await db
    .select({
      id: sales.id,
      receiptNo: sales.receiptNo,
      productName: saleItems.productName,
    })
    .from(sales)
    .leftJoin(saleItems, eq(saleItems.saleId, sales.id))
    .where(
      and(
        eq(sales.storeId, storeId),
        or(
          ilike(saleItems.productName, like),
          ilike(sql`${sales.receiptNo}::text`, like),
        ),
      ),
    )
    .limit(5);
  if (saleRows.length) {
    groups.push({
      type: "penjualan",
      label: "Penjualan",
      items: saleRows.map((r) => ({
        to: `/struk/${r.id}`,
        title: `Struk #${r.receiptNo}`,
        subtitle: r.productName ?? "",
      })),
    });
  }

  // --- Pelanggan ------------------------------------------------------------
  const customerRows = await db
    .select({ id: customers.id, name: customers.name, phone: customers.phone })
    .from(customers)
    .where(
      and(
        eq(customers.businessId, businessId),
        or(ilike(customers.name, like), ilike(customers.phone, like)),
      ),
    )
    .limit(5);
  if (customerRows.length) {
    groups.push({
      type: "pelanggan",
      label: "Pelanggan",
      items: customerRows.map((r) => ({
        to: `/pelanggan?id=${r.id}`,
        title: r.name,
        subtitle: r.phone ?? "",
      })),
    });
  }

  // --- Pemasok & pembelian (khusus admin) -----------------------------------
  if (role === "admin") {
    const supplierRows = await db
      .select({ name: suppliers.name, address: suppliers.address })
      .from(suppliers)
      .where(
        and(
          eq(suppliers.businessId, businessId),
          or(ilike(suppliers.name, like), ilike(suppliers.address, like)),
        ),
      )
      .limit(5);
    if (supplierRows.length) {
      groups.push({
        type: "pemasok",
        label: "Pemasok",
        items: supplierRows.map((r) => ({
          to: `/pemasok?q=${encodeURIComponent(r.name)}`,
          title: r.name,
          subtitle: r.address ?? "",
        })),
      });
    }

    const poRows = await db
      .select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        supplierName: suppliers.name,
      })
      .from(purchaseOrders)
      .leftJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(
        and(
          eq(purchaseOrders.storeId, storeId),
          or(
            ilike(purchaseOrders.poNumber, like),
            ilike(suppliers.name, like),
          ),
        ),
      )
      .limit(5);
    if (poRows.length) {
      groups.push({
        type: "pembelian",
        label: "Pembelian",
        items: poRows.map((r) => ({
          to: `/pembelian?id=${r.id}`,
          title: r.poNumber,
          subtitle: r.supplierName ?? "",
        })),
      });
    }
  }

  return groups;
}
