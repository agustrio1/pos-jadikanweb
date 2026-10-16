import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  businesses,
  customers,
  inventory,
  payments,
  productVariants,
  products,
  saleItems,
  saleReturns,
  sales,
  stockMovements,
  stores,
  users,
} from "../db/schema";
import { UserError } from "../errors";
import { formatReceiptNo, variantLabel } from "~/lib/format";
import type { SaleInput } from "~/lib/schemas";
import {
  REDEEM_RUPIAH_PER_POINT,
  normalizeRedeemPoints,
  pointsEarned,
  redeemDiscount,
} from "~/lib/loyalty-rules";
import { createDebt } from "./debts";
import { adjustPoints, lockCustomer } from "./loyalty";
import { computeTaxAmount } from "./tax";

type Actor = { businessId: string; storeId: string; userId: string };

const MAX_AMOUNT = 2_000_000_000;

export async function createSale(
  db: Db,
  actor: Actor,
  input: SaleInput,
): Promise<{ saleId: string; duplicate: boolean }> {
  return db.transaction(async (tx) => {
    // Kunci baris toko: menyerialkan penjualan per toko sehingga nomor
    // struk berurutan dan pengecekan idempotensi bebas balapan.
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
      .select({ id: sales.id })
      .from(sales)
      .where(
        and(
          eq(sales.storeId, actor.storeId),
          eq(sales.clientId, input.clientId),
        ),
      )
      .limit(1);
    if (existing) return { saleId: existing.id, duplicate: true };

    const [cashier] = await tx
      .select({
        role: users.role,
        maxDiscountPct: users.maxDiscountPct,
        isActive: users.isActive,
      })
      .from(users)
      .where(
        and(
          eq(users.id, actor.userId),
          eq(users.businessId, actor.businessId),
        ),
      )
      .limit(1);
    if (!cashier || !cashier.isActive) {
      throw new UserError("Akun tidak aktif.");
    }

    const ids = input.items.map((item) => item.variantId);

    const found = await tx
      .select({
        variantId: productVariants.id,
        productId: productVariants.productId,
        sku: productVariants.sku,
        size: productVariants.size,
        color: productVariants.color,
        costPrice: productVariants.costPrice,
        sellPrice: productVariants.sellPrice,
        productName: products.name,
        taxable: products.taxable,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(
        and(
          inArray(productVariants.id, ids),
          eq(productVariants.businessId, actor.businessId),
          eq(productVariants.isActive, true),
          eq(products.isActive, true),
        ),
      );
    const byId = new Map(found.map((row) => [row.variantId, row]));

    // Jumlah varian aktif per produk, untuk label cadangan (SKU) pada varian
    // tanpa ukuran/warna. Aturannya sama dengan snapshot katalog.
    const productIds = [...new Set(found.map((row) => row.productId))];
    const countRows =
      productIds.length === 0
        ? []
        : await tx
            .select({
              productId: productVariants.productId,
              n: sql<number>`count(*)`.mapWith(Number),
            })
            .from(productVariants)
            .where(
              and(
                inArray(productVariants.productId, productIds),
                eq(productVariants.businessId, actor.businessId),
                eq(productVariants.isActive, true),
              ),
            )
            .groupBy(productVariants.productId);
    const variantCount = new Map(countRows.map((row) => [row.productId, row.n]));

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
    const stockById = new Map(stockRows.map((row) => [row.variantId, row.qty]));

    const lines = input.items.map((item) => {
      const variant = byId.get(item.variantId);
      if (!variant) {
        throw new UserError(
          "Ada produk yang sudah tidak tersedia. Muat ulang halaman kasir.",
        );
      }
      const available = stockById.get(item.variantId) ?? 0;
      if (item.qty > available) {
        throw new UserError(
          `Stok "${variant.productName}" tidak cukup (tersisa ${available}).`,
        );
      }
      return {
        ...item,
        ...variant,
        label:
          variantLabel(variant.size, variant.color) ??
          ((variantCount.get(variant.productId) ?? 0) > 1 ? variant.sku : null),
        lineTotal: variant.sellPrice * item.qty,
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
      cashier.role !== "admin" &&
      discountAmount * 100 > subtotal * cashier.maxDiscountPct
    ) {
      throw new UserError(
        `Diskon melebihi batas kewenangan Anda (${cashier.maxDiscountPct}%).`,
      );
    }

    const totalBeforeLoyalty = subtotal - discountAmount;

    // Loyalti: pelanggan opsional; poin yang ditukar menjadi diskon tambahan.
    // Nilai uang selalu dihitung ulang & divalidasi server (saldo dikunci).
    const customerId = input.customerId ?? null;
    let loyaltyDiscount = 0;
    if (customerId) {
      const cust = await lockCustomer(tx, {
        businessId: actor.businessId,
        customerId,
      });
      const requested = input.redeemPoints ?? 0;
      if (requested > 0) {
        // Batasi agar diskon tidak melebihi tagihan dan tetap kelipatan berlaku.
        const pointsCap = Math.floor(totalBeforeLoyalty / REDEEM_RUPIAH_PER_POINT);
        const used = Math.min(
          normalizeRedeemPoints(requested, cust.points),
          normalizeRedeemPoints(pointsCap, cust.points),
        );
        if (used <= 0) {
          throw new UserError(
            "Poin tidak mencukupi atau penukaran harus dalam kelipatan yang berlaku.",
          );
        }
        loyaltyDiscount = redeemDiscount(used);
        await adjustPoints(tx, customerId, -used);
      }
    }

    const total = totalBeforeLoyalty - loyaltyDiscount;

    // PPN inklusif: hanya dipecah dari total untuk pelaporan; tidak mengubah
    // jumlah yang dibayar. Barang non-taxable tidak menyumbang dasar PPN.
    const taxAmount = computeTaxAmount(
      lines.map((line) => ({
        variantId: line.variantId,
        lineTotal: line.lineTotal,
        taxable: line.taxable,
      })),
      subtotal,
      discountAmount,
    );

    // Akumulasi poin dari total akhir (1 poin per Rp1.000 omzet).
    if (customerId) {
      const earned = pointsEarned(total);
      if (earned > 0) await adjustPoints(tx, customerId, earned);
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
        customerId,
        subtotal,
        discountAmount,
        total,
        taxAmount,
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
        unitPrice: line.sellPrice,
        costPrice: line.costPrice,
        lineTotal: line.lineTotal,
      })),
    );

    // Susun baris pembayaran. Jika klien mengirim rincian metode (non-tunai/
    // campuran), jumlahkan dan validasi terhadap total. Jika tidak, pakai jalur
    // lama tunai penuh dari cashReceived (kompatibel mundur).
    type PaymentRow = {
      saleId: string;
      method: "cash" | "qris" | "debit" | "credit";
      amount: number;
      tendered: number;
      changeAmount: number;
      reference: string | null;
    };
    let paymentRows: PaymentRow[];

    if (input.payments && input.payments.length > 0) {
      const sum = input.payments.reduce((s, p) => s + p.amount, 0);
      if (sum !== total) {
        throw new UserError("Total pembayaran tidak sama dengan tagihan.");
      }
      paymentRows = input.payments.map((p) => {
        if (p.method === "cash") {
          const tendered = p.tendered ?? p.amount;
          if (tendered < p.amount) {
            throw new UserError("Uang tunai kurang dari bagian tunai.");
          }
          return {
            saleId: sale.id,
            method: "cash",
            amount: p.amount,
            tendered,
            changeAmount: tendered - p.amount,
            reference: p.reference ?? null,
          };
        }
        return {
          saleId: sale.id,
          method: p.method,
          amount: p.amount,
          tendered: p.amount,
          changeAmount: 0,
          reference: p.reference ?? null,
        };
      });
    } else {
      if (input.cashReceived < total) {
        throw new UserError("Uang diterima kurang dari total.");
      }
      paymentRows = [
        {
          saleId: sale.id,
          method: "cash",
          amount: total,
          tendered: input.cashReceived,
          changeAmount: input.cashReceived - total,
          reference: null,
        },
      ];
    }

    await tx.insert(payments).values(paymentRows);

    // Piutang: bagian pembayaran `credit` memerlukan pelanggan dan membentuk
    // utang terbuka yang bisa dicicil (Fase 6).
    const creditAmount = input.payments
      ? input.payments
          .filter((p) => p.method === "credit")
          .reduce((s, p) => s + p.amount, 0)
      : 0;
    if (creditAmount > 0) {
      if (!customerId) {
        throw new UserError("Pembayaran kredit memerlukan pemilihan pelanggan.");
      }
      await createDebt(tx, {
        businessId: actor.businessId,
        storeId: actor.storeId,
        customerId,
        saleId: sale.id,
        amount: creditAmount,
        createdBy: actor.userId,
      });
    }

    for (const line of lines) {
      await tx
        .update(inventory)
        .set({
          qty: sql`${inventory.qty} - ${line.qty}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(inventory.storeId, actor.storeId),
            eq(inventory.variantId, line.variantId),
          ),
        );
    }

    await tx.insert(stockMovements).values(
      lines.map((line) => ({
        storeId: actor.storeId,
        variantId: line.variantId,
        delta: -line.qty,
        type: "sale" as const,
        reason: `Penjualan ${formatReceiptNo(receiptNo)}`,
        refSaleId: sale.id,
        createdBy: actor.userId,
      })),
    );

    await tx
      .update(stores)
      .set({ lastReceiptNo: receiptNo })
      .where(eq(stores.id, actor.storeId));

    return { saleId: sale.id, duplicate: false };
  });
}

export async function getReceipt(
  db: Db,
  opts: {
    businessId: string;
    storeId: string;
    saleId: string;
    cashierId?: string;
  },
) {
  const conditions = [
    eq(sales.id, opts.saleId),
    eq(sales.businessId, opts.businessId),
    eq(sales.storeId, opts.storeId),
  ];
  if (opts.cashierId) conditions.push(eq(sales.cashierId, opts.cashierId));

  const [sale] = await db
    .select({
      id: sales.id,
      receiptNo: sales.receiptNo,
      status: sales.status,
      subtotal: sales.subtotal,
      discountAmount: sales.discountAmount,
      total: sales.total,
      taxAmount: sales.taxAmount,
      soldAt: sales.soldAt,
      storeName: stores.name,
      storeAddress: stores.address,
      businessName: businesses.name,
      cashierName: users.name,
      customerName: customers.name,
    })
    .from(sales)
    .innerJoin(stores, eq(stores.id, sales.storeId))
    .innerJoin(businesses, eq(businesses.id, sales.businessId))
    .leftJoin(users, eq(users.id, sales.cashierId))
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .where(and(...conditions))
    .limit(1);

  if (!sale) return null;

  const items = await db
    .select({
      id: saleItems.id,
      variantId: saleItems.variantId,
      productName: saleItems.productName,
      sku: saleItems.sku,
      variantLabel: saleItems.variantLabel,
      qty: saleItems.qty,
      unitPrice: saleItems.unitPrice,
      lineTotal: saleItems.lineTotal,
    })
    .from(saleItems)
    .where(eq(saleItems.saleId, sale.id))
    .orderBy(asc(saleItems.productName), asc(saleItems.sku));

  const paymentRows = await db
    .select({
      id: payments.id,
      method: payments.method,
      amount: payments.amount,
      tendered: payments.tendered,
      changeAmount: payments.changeAmount,
      reference: payments.reference,
    })
    .from(payments)
    .where(eq(payments.saleId, sale.id))
    .orderBy(asc(payments.createdAt), asc(payments.id));

  return { sale, items, payments: paymentRows };
}

export async function listSales(
  db: Db,
  opts: {
    businessId: string;
    storeId: string;
    cashierId?: string;
    limit?: number;
  },
) {
  const conditions = [
    eq(sales.businessId, opts.businessId),
    eq(sales.storeId, opts.storeId),
  ];
  if (opts.cashierId) conditions.push(eq(sales.cashierId, opts.cashierId));

  return db
    .select({
      id: sales.id,
      receiptNo: sales.receiptNo,
      soldAt: sales.soldAt,
      status: sales.status,
      total: sales.total,
      cashierName: users.name,
      itemCount: sql<number>`(select coalesce(sum(${saleItems.qty}), 0) from ${saleItems} where ${saleItems.saleId} = ${sales.id})`.mapWith(
        Number,
      ),
      // Ada retur parsial pada transaksi ini? Dipakai untuk badge "Diretur".
      hasReturns: sql<boolean>`exists (select 1 from ${saleReturns} where ${saleReturns.saleId} = ${sales.id})`.mapWith(
        Boolean,
      ),
    })
    .from(sales)
    .leftJoin(users, eq(users.id, sales.cashierId))
    .where(and(...conditions))
    .orderBy(desc(sales.soldAt), desc(sales.receiptNo))
    .limit(opts.limit ?? 100);
}