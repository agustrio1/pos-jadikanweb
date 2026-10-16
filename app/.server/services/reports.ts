import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  inventory,
  offlineSales,
  payments,
  productVariants,
  products,
  saleConflicts,
  saleItems,
  sales,
  users,
} from "../db/schema";

const DAY_MS = 86_400_000;
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export type DateRange = { from: string; to: string; start: Date; end: Date };

function validDay(value: string | null): string | null {
  if (!value || !ISO_DAY.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === value ? value : null;
}

// Jakarta tidak memakai DST, jadi offset tetap +07:00 aman.
export const jakartaToday = () =>
  new Date(Date.now() + JAKARTA_OFFSET_MS).toISOString().slice(0, 10);

export function addDays(day: string, amount: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + amount * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function makeRange(from: string, to: string): DateRange {
  return {
    from,
    to,
    start: new Date(`${from}T00:00:00+07:00`),
    end: new Date(`${addDays(to, 1)}T00:00:00+07:00`),
  };
}

export function parseRange(
  fromParam: string | null,
  toParam: string | null,
): { range: DateRange; note: string | null } {
  const today = jakartaToday();
  const fallback = makeRange(today, today);
  if (!fromParam && !toParam) return { range: fallback, note: null };

  const from = validDay(fromParam);
  const to = validDay(toParam);
  if (!from || !to) {
    return {
      range: fallback,
      note: "Tanggal tidak valid. Menampilkan hari ini.",
    };
  }
  if (from > to) {
    return {
      range: fallback,
      note: "Tanggal awal melebihi tanggal akhir. Menampilkan hari ini.",
    };
  }
  const days =
    Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        DAY_MS,
    ) + 1;
  if (days > MAX_RANGE_DAYS) {
    return {
      range: fallback,
      note: `Rentang maksimal ${MAX_RANGE_DAYS} hari. Menampilkan hari ini.`,
    };
  }
  return { range: makeRange(from, to), note: null };
}

export function rangePresets() {
  const today = jakartaToday();
  return [
    { label: "Hari ini", from: today, to: today },
    { label: "7 hari", from: addDays(today, -6), to: today },
    { label: "30 hari", from: addDays(today, -29), to: today },
    { label: "Bulan ini", from: `${today.slice(0, 8)}01`, to: today },
  ];
}

type Scope = { businessId: string; storeId: string };

// Hanya transaksi berstatus completed yang masuk omzet. Transaksi batal
// dihitung terpisah (voidCount/voidTotal) dan tidak pernah masuk omzet.
export async function getSalesReport(
  db: Db,
  opts: Scope & { range: DateRange },
) {
  const { businessId, storeId, range } = opts;

  const dayExpr = sql<string>`to_char(${sales.soldAt} AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')`;
  const hourExpr = sql<string>`to_char(${sales.soldAt} AT TIME ZONE 'Asia/Jakarta', 'HH24')`;
  const inRange = and(
    eq(sales.businessId, businessId),
    eq(sales.storeId, storeId),
    gte(sales.soldAt, range.start),
    lt(sales.soldAt, range.end),
  );
  const completed = and(inRange, eq(sales.status, "completed"));

  const [byDay, cogsRows, topProducts, paymentRows, offline, conflicts, byHour, byCashier] =
    await Promise.all([
      db
        .select({
          day: dayExpr,
          count:
            sql<number>`count(*) filter (where ${sales.status} = 'completed')`.mapWith(
              Number,
            ),
          revenue:
            sql<number>`coalesce(sum(${sales.total}) filter (where ${sales.status} = 'completed'), 0)`.mapWith(
              Number,
            ),
          discount:
            sql<number>`coalesce(sum(${sales.discountAmount}) filter (where ${sales.status} = 'completed'), 0)`.mapWith(
              Number,
            ),
          tax:
            sql<number>`coalesce(sum(${sales.taxAmount}) filter (where ${sales.status} = 'completed'), 0)`.mapWith(
              Number,
            ),
          voidCount:
            sql<number>`count(*) filter (where ${sales.status} = 'void')`.mapWith(
              Number,
            ),
          voidTotal:
            sql<number>`coalesce(sum(${sales.total}) filter (where ${sales.status} = 'void'), 0)`.mapWith(
              Number,
            ),
        })
        .from(sales)
        .where(inRange)
        .groupBy(dayExpr),

      db
        .select({
          day: dayExpr,
          cogs: sql<number>`coalesce(sum(${saleItems.costPrice}::bigint * ${saleItems.qty}), 0)`.mapWith(
            Number,
          ),
        })
        .from(saleItems)
        .innerJoin(sales, eq(sales.id, saleItems.saleId))
        .where(completed)
        .groupBy(dayExpr),

      db
        .select({
          variantId: saleItems.variantId,
          productName: sql<string>`max(${saleItems.productName})`,
          sku: sql<string>`max(${saleItems.sku})`,
          label: sql<string | null>`max(${saleItems.variantLabel})`,
          qty: sql<number>`sum(${saleItems.qty})`.mapWith(Number),
          gross: sql<number>`sum(${saleItems.lineTotal})`.mapWith(Number),
        })
        .from(saleItems)
        .innerJoin(sales, eq(sales.id, saleItems.saleId))
        .where(completed)
        .groupBy(saleItems.variantId)
        .orderBy(desc(sql`sum(${saleItems.qty})`), asc(sql`max(${saleItems.productName})`))
        .limit(20),

      db
        .select({
          method: payments.method,
          count: sql<number>`count(*)`.mapWith(Number),
          amount: sql<number>`coalesce(sum(${payments.amount}), 0)`.mapWith(
            Number,
          ),
        })
        .from(payments)
        .innerJoin(sales, eq(sales.id, payments.saleId))
        .where(completed)
        .groupBy(payments.method),

      db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(offlineSales)
        .innerJoin(sales, eq(sales.id, offlineSales.saleId))
        .where(completed),

      db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(saleConflicts)
        .where(
          and(
            eq(saleConflicts.storeId, storeId),
            eq(saleConflicts.status, "open"),
          ),
        ),

      // Padatan jam (waktu Jakarta). Hanya transaksi completed yang dihitung.
      db
        .select({
          hour: hourExpr,
          count:
            sql<number>`count(*) filter (where ${sales.status} = 'completed')`.mapWith(
              Number,
            ),
          revenue:
            sql<number>`coalesce(sum(${sales.total}) filter (where ${sales.status} = 'completed'), 0)`.mapWith(
              Number,
            ),
        })
        .from(sales)
        .where(inRange)
        .groupBy(hourExpr),

      // Rekap per kasir. Rata-rata diskon % dihitung di JS dari subtotal.
      db
        .select({
          cashierId: sales.cashierId,
          cashierName: users.name,
          count:
            sql<number>`count(*) filter (where ${sales.status} = 'completed')`.mapWith(
              Number,
            ),
          revenue:
            sql<number>`coalesce(sum(${sales.total}) filter (where ${sales.status} = 'completed'), 0)`.mapWith(
              Number,
            ),
          discount:
            sql<number>`coalesce(sum(${sales.discountAmount}) filter (where ${sales.status} = 'completed'), 0)`.mapWith(
              Number,
            ),
          subtotal:
            sql<number>`coalesce(sum(${sales.subtotal}) filter (where ${sales.status} = 'completed'), 0)`.mapWith(
              Number,
            ),
        })
        .from(sales)
        .leftJoin(users, eq(users.id, sales.cashierId))
        .where(inRange)
        .groupBy(sales.cashierId, users.name),
    ]);

  const cogsByDay = new Map(cogsRows.map((row) => [row.day, row.cogs]));
  const days = byDay
    .map((row) => {
      const cogs = cogsByDay.get(row.day) ?? 0;
      return { ...row, cogs, profit: row.revenue - cogs };
    })
    .sort((a, b) => b.day.localeCompare(a.day));

  const totals = days.reduce(
    (sum, day) => ({
      count: sum.count + day.count,
      revenue: sum.revenue + day.revenue,
      discount: sum.discount + day.discount,
      tax: sum.tax + day.tax,
      cogs: sum.cogs + day.cogs,
      profit: sum.profit + day.profit,
      voidCount: sum.voidCount + day.voidCount,
      voidTotal: sum.voidTotal + day.voidTotal,
    }),
    {
      count: 0,
      revenue: 0,
      discount: 0,
      tax: 0,
      cogs: 0,
      profit: 0,
      voidCount: 0,
      voidTotal: 0,
    },
  );

  const byHourSorted = [...byHour]
    .filter((row) => row.hour !== null)
    .sort((a, b) => a.hour.localeCompare(b.hour));

  const byCashierSorted = byCashier
    .map((row) => ({
      cashierId: row.cashierId,
      cashierName: row.cashierName,
      count: row.count,
      revenue: row.revenue,
      discount: row.discount,
      avgDiscountPct:
        row.subtotal > 0 ? Math.round((row.discount / row.subtotal) * 100) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return {
    days,
    totals,
    payments: paymentRows,
    topProducts,
    byHour: byHourSorted,
    byCashier: byCashierSorted,
    offlineSalesCount: offline[0]?.count ?? 0,
    openConflicts: conflicts[0]?.count ?? 0,
  };
}

export async function getInventoryReport(db: Db, opts: Scope) {
  const { businessId, storeId } = opts;

  const qtyRaw = sql`coalesce(${inventory.qty}, 0)`;
  const minRaw = sql`coalesce(${inventory.minQty}, 0)`;

  const joinInventory = and(
    eq(inventory.variantId, productVariants.id),
    eq(inventory.storeId, storeId),
  );
  const activeVariants = and(
    eq(productVariants.businessId, businessId),
    eq(productVariants.isActive, true),
    eq(products.isActive, true),
  );

  const [[summary], lowItems] = await Promise.all([
    db
      .select({
        variants: sql<number>`count(*)`.mapWith(Number),
        units: sql<number>`coalesce(sum(greatest(${qtyRaw}, 0)), 0)`.mapWith(
          Number,
        ),
        costValue:
          sql<number>`coalesce(sum(greatest(${qtyRaw}, 0)::bigint * ${productVariants.costPrice}), 0)`.mapWith(
            Number,
          ),
        sellValue:
          sql<number>`coalesce(sum(greatest(${qtyRaw}, 0)::bigint * ${productVariants.sellPrice}), 0)`.mapWith(
            Number,
          ),
        empty: sql<number>`count(*) filter (where ${qtyRaw} = 0)`.mapWith(
          Number,
        ),
        negative: sql<number>`count(*) filter (where ${qtyRaw} < 0)`.mapWith(
          Number,
        ),
        low: sql<number>`count(*) filter (where ${qtyRaw} <= ${minRaw})`.mapWith(
          Number,
        ),
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(inventory, joinInventory)
      .where(activeVariants),

    db
      .select({
        variantId: productVariants.id,
        productName: products.name,
        sku: productVariants.sku,
        size: productVariants.size,
        color: productVariants.color,
        qty: sql<number>`${qtyRaw}`.mapWith(Number),
        minQty: sql<number>`${minRaw}`.mapWith(Number),
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(inventory, joinInventory)
      .where(and(activeVariants, sql`${qtyRaw} <= ${minRaw}`))
      .orderBy(asc(qtyRaw), asc(products.name), asc(productVariants.sku))
      .limit(200),
  ]);

  return {
    summary: summary ?? {
      variants: 0,
      units: 0,
      costValue: 0,
      sellValue: 0,
      empty: 0,
      negative: 0,
      low: 0,
    },
    lowItems,
  };
}