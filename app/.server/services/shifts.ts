import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import {
  payments,
  saleReturns,
  sales,
  shifts,
  users,
} from "../db/schema";
import { UserError } from "../errors";
import { formatRupiah } from "~/lib/format";
import { writeAudit } from "./audit";

type Actor = { businessId: string; storeId: string; userId: string };

// Nama kolom tidak boleh ambigu saat join, jadi pakai alias tabel eksplisit.
const cash = "cash";

// Jumlah uang tunai yang benar-benar masuk/ keluar laci kas selama sebuah shift:
//   cashIn  = Σ bagian tunai pembayaran pada transaksi completed milik kasir ini
//             (bagian tunai = amount, bukan tendered; kembalian sudah terpotong)
//   cashOut = Σ pengembalian uang retur pada transaksi tunai milik kasir ini
// Rentang waktu mengikuti periode shift (openedAt..to).
async function computeCash(
  db: Db | Tx,
  shift: { storeId: string; openedBy: string | null; openedAt: Date },
  to: Date,
): Promise<{ cashIn: number; cashOut: number }> {
  const owner = shift.openedBy;
  const ownerCond = owner
    ? eq(sales.cashierId, owner)
    : sql`false /* tanpa pelaksana: tidak ada transaksi */`;

  const [inRow] = await db
    .select({
      v:
        sql<number>`coalesce(sum(${payments.amount}), 0)`.mapWith(Number),
    })
    .from(payments)
    .innerJoin(sales, eq(sales.id, payments.saleId))
    .where(
      and(
        eq(sales.storeId, shift.storeId),
        ownerCond,
        eq(payments.method, cash),
        eq(sales.status, "completed"),
        gte(sales.soldAt, shift.openedAt),
        sql`${sales.soldAt} <= ${to}`,
      ),
    );

  // Hanya retur atas transaksi yang punya pembayaran tunai yang mengurangi kas.
  const [outRow] = await db
    .select({
      v:
        sql<number>`coalesce(sum(${saleReturns.refundAmount}), 0)`.mapWith(
          Number,
        ),
    })
    .from(saleReturns)
    .innerJoin(sales, eq(sales.id, saleReturns.saleId))
    .where(
      and(
        eq(saleReturns.storeId, shift.storeId),
        ownerCond,
        gte(saleReturns.createdAt, shift.openedAt),
        sql`${saleReturns.createdAt} <= ${to}`,
        sql`exists (select 1 from ${payments} p where p.sale_id = ${saleReturns.saleId} and p.method = ${cash})`,
      ),
    );

  return { cashIn: inRow?.v ?? 0, cashOut: outRow?.v ?? 0 };
}

// Membuka shift kas baru. Ditolak bila pelaksana sudah punya shift open aktif.
export async function openShift(
  db: Db,
  actor: Actor,
  input: { openingFloat: number; notes?: string | null },
): Promise<{ shiftId: string }> {
  if (!Number.isInteger(input.openingFloat) || input.openingFloat < 0) {
    throw new UserError("Uang modal awal tidak valid.");
  }
  return db.transaction(async (tx) => {
    const active = await getActiveShift(db, actor);
    if (active) {
      throw new UserError("Shift aktif sudah terbuka. Tutup lebih dulu.");
    }
    const [row] = await tx
      .insert(shifts)
      .values({
        businessId: actor.businessId,
        storeId: actor.storeId,
        openedBy: actor.userId,
        openingFloat: input.openingFloat,
        notes: input.notes ?? null,
        status: "open",
      })
      .returning({ id: shifts.id });
    return { shiftId: row.id };
  });
}

// Shift open milik pelaksana di toko ini (bila ada), lengkap dengan ringkasan
// kas sementara untuk ditampilkan secara langsung.
export async function getActiveShift(db: Db, actor: Actor) {
  const [row] = await db
    .select({
      id: shifts.id,
      storeId: shifts.storeId,
      openedBy: shifts.openedBy,
      openedAt: shifts.openedAt,
      openingFloat: shifts.openingFloat,
      notes: shifts.notes,
      openedByName: users.name,
    })
    .from(shifts)
    .leftJoin(users, eq(users.id, shifts.openedBy))
    .where(
      and(
        eq(shifts.storeId, actor.storeId),
        eq(shifts.openedBy, actor.userId),
        eq(shifts.status, "open"),
      ),
    )
    .limit(1);
  if (!row) return null;

  const { cashIn, cashOut } = await computeCash(db, row, new Date());
  return {
    ...row,
    cashIn,
    cashOut,
    expectedCash: row.openingFloat + cashIn - cashOut,
  };
}

// Menutup shift: hitung kas perkiraan, simpan hasil hitung fisik & selisih,
// lalu tulis jejak audit. Idempoten terhadap shift yang sudah tertutup.
export async function closeShift(
  db: Db,
  actor: Actor,
  input: { shiftId: string; countedCash: number; notes?: string | null },
): Promise<{ variance: number; expectedCash: number }> {
  if (!Number.isInteger(input.countedCash) || input.countedCash < 0) {
    throw new UserError("Hasil hitung fisik tidak valid.");
  }
  return db.transaction(async (tx) => {
    const [shift] = await tx
      .select()
      .from(shifts)
      .where(
        and(
          eq(shifts.id, input.shiftId),
          eq(shifts.storeId, actor.storeId),
          eq(shifts.businessId, actor.businessId),
        ),
      )
      .for("update")
      .limit(1);
    if (!shift) throw new UserError("Shift tidak ditemukan.");
    if (shift.status !== "open") {
      throw new UserError("Shift ini sudah ditutup.");
    }

    const closedAt = new Date();
    const { cashIn, cashOut } = await computeCash(tx, shift, closedAt);
    const expectedCash = shift.openingFloat + cashIn - cashOut;
    const variance = input.countedCash - expectedCash;

    await tx
      .update(shifts)
      .set({
        status: "closed",
        closedAt,
        closedBy: actor.userId,
        countedCash: input.countedCash,
        expectedCash,
        variance,
        notes: input.notes ?? shift.notes,
      })
      .where(eq(shifts.id, shift.id));

    await writeAudit(tx, {
      businessId: actor.businessId,
      storeId: actor.storeId,
      actorId: actor.userId,
      action: "shift_close",
      entityType: "shift",
      entityId: shift.id,
      detail: `Tutup shift. Kas perkiraan ${formatRupiah(expectedCash)}, hitung fisik ${formatRupiah(input.countedCash)}, selisih ${formatRupiah(variance)}.`,
    });

    return { variance, expectedCash };
  });
}

// Riwayat shift untuk suatu toko dalam rentang waktu (untuk laporan selisih).
export async function listShifts(
  db: Db,
  opts: { storeId: string; limit?: number },
) {
  return db
    .select({
      id: shifts.id,
      openedAt: shifts.openedAt,
      closedAt: shifts.closedAt,
      status: shifts.status,
      openingFloat: shifts.openingFloat,
      countedCash: shifts.countedCash,
      expectedCash: shifts.expectedCash,
      variance: shifts.variance,
      notes: shifts.notes,
      openedByName: users.name,
      closedByName: users.name,
    })
    .from(shifts)
    .leftJoin(users, eq(users.id, shifts.openedBy))
    .where(eq(shifts.storeId, opts.storeId))
    .orderBy(desc(shifts.openedAt))
    .limit(opts.limit ?? 200);
}
