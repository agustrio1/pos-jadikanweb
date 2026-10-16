import { and, eq, sql } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import { customers } from "../db/schema";
import { UserError } from "../errors";

// Membaca pelanggan + saldo poin sambil mengunci barisnya (FOR UPDATE) supaya
// penukaran poin tidak dipakai dua kali saat dua transaksi bersamaan.
export async function lockCustomer(
  tx: Tx,
  opts: { businessId: string; customerId: string },
): Promise<{ points: number }> {
  const [row] = await tx
    .select({ points: customers.points })
    .from(customers)
    .where(
      and(
        eq(customers.id, opts.customerId),
        eq(customers.businessId, opts.businessId),
      ),
    )
    .for("update")
    .limit(1);
  if (!row) throw new UserError("Pelanggan tidak ditemukan.");
  return row;
}

// Menambah/mengurangi poin atomik. Mengembalikan true bila pengurangan berhasil
// (saldo cukup) — dipakai saat redeem di dalam transaksi penjualan.
export async function adjustPoints(
  tx: Tx,
  customerId: string,
  delta: number,
): Promise<void> {
  await tx
    .update(customers)
    .set({ points: sql`${customers.points} + ${delta}` })
    .where(eq(customers.id, customerId));
}

// Memastikan pelanggan masih terdaftar untuk suatu bisnis (dipakai jalur sync).
export async function customerExists(
  db: Db | Tx,
  opts: { businessId: string; customerId: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(
      and(
        eq(customers.id, opts.customerId),
        eq(customers.businessId, opts.businessId),
      ),
    )
    .limit(1);
  return Boolean(row);
}
