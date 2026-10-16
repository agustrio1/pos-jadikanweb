import { and, desc, eq, sql } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import {
  customers,
  debtPayments,
  debts,
  sales,
} from "../db/schema";
import { UserError } from "../errors";
import { formatRupiah } from "~/lib/format";
import { writeAudit } from "./audit";

type PaymentMethodValue = "cash" | "qris" | "debit" | "credit";

// Membuat piutang dari bagian pembayaran `credit` sebuah transaksi. Dipanggil
// di dalam transaksi createSale/syncSale agar atomik dengan penjualannya.
export async function createDebt(
  tx: Tx,
  input: {
    businessId: string;
    storeId: string;
    customerId: string;
    saleId: string;
    amount: number;
    dueDate?: Date | null;
    createdBy: string;
  },
): Promise<string> {
  if (input.amount <= 0) {
    throw new UserError("Nilai piutang harus lebih dari nol.");
  }
  const [row] = await tx
    .insert(debts)
    .values({
      businessId: input.businessId,
      storeId: input.storeId,
      customerId: input.customerId,
      saleId: input.saleId,
      amount: input.amount,
      balance: input.amount,
      dueDate: input.dueDate ?? null,
      status: "open",
      createdBy: input.createdBy,
    })
    .returning({ id: debts.id });
  return row.id;
}

export async function listOpenDebts(db: Db, opts: { businessId: string }) {
  return db
    .select({
      id: debts.id,
      customerId: debts.customerId,
      customerName: customers.name,
      saleId: debts.saleId,
      receiptNo: sales.receiptNo,
      amount: debts.amount,
      balance: debts.balance,
      dueDate: debts.dueDate,
      createdAt: debts.createdAt,
    })
    .from(debts)
    .innerJoin(customers, eq(customers.id, debts.customerId))
    .leftJoin(sales, eq(sales.id, debts.saleId))
    .where(
      and(
        eq(debts.businessId, opts.businessId),
        eq(debts.status, "open"),
      ),
    )
    .orderBy(desc(debts.createdAt));
}

// Total saldo piutang terbuka seorang pelanggan.
export async function customerOutstanding(
  db: Db | Tx,
  customerId: string,
): Promise<number> {
  const [row] = await db
    .select({
      balance: sql<number>`coalesce(sum(${debts.balance}), 0)`.mapWith(Number),
    })
    .from(debts)
    .where(and(eq(debts.customerId, customerId), eq(debts.status, "open")));
  return row?.balance ?? 0;
}

// Rekap agregat piutang untuk halaman laporan.
export async function outstandingSummary(
  db: Db,
  opts: { businessId: string },
): Promise<{ total: number; count: number }> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${debts.balance}), 0)`.mapWith(Number),
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(debts)
    .where(
      and(
        eq(debts.businessId, opts.businessId),
        eq(debts.status, "open"),
      ),
    );
  return { total: row?.total ?? 0, count: row?.count ?? 0 };
}

// Pelanggan dengan total piutang terbuka terbesar (untuk laporan).
export async function topDebtors(
  db: Db,
  opts: { businessId: string; limit?: number },
) {
  return db
    .select({
      customerId: debts.customerId,
      customerName: customers.name,
      balance:
        sql<number>`coalesce(sum(${debts.balance}), 0)`.mapWith(Number),
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(debts)
    .innerJoin(customers, eq(customers.id, debts.customerId))
    .where(
      and(
        eq(debts.businessId, opts.businessId),
        eq(debts.status, "open"),
      ),
    )
    .groupBy(debts.customerId, customers.name)
    .orderBy(desc(sql`sum(${debts.balance})`))
    .limit(opts.limit ?? 10);
}

// Mencatat cicilan pembayaran piutang: kurangi balance, tandai lunas saat 0,
// dan tulis jejak audit. Piutang adalah ledger kas tersendiri (tabel
// debt_payments) sehingga tidak mengubah baris `payments` transaksi asal
// (menjaga invariant jumlah pembayaran = total tagihan).
export async function recordDebtPayment(
  db: Db,
  actor: { businessId: string; userId: string },
  input: {
    debtId: string;
    amount: number;
    method: PaymentMethodValue;
    reference?: string | null;
  },
): Promise<{ newBalance: number; status: "open" | "paid" }> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new UserError("Nilai pembayaran tidak valid.");
  }
  if (input.method === "credit") {
    throw new UserError("Metode pembayaran cicilan tidak boleh kredit.");
  }

  return db.transaction(async (tx) => {
    const [debt] = await tx
      .select()
      .from(debts)
      .where(
        and(
          eq(debts.id, input.debtId),
          eq(debts.businessId, actor.businessId),
        ),
      )
      .for("update")
      .limit(1);
    if (!debt) throw new UserError("Piutang tidak ditemukan.");
    if (debt.status !== "open") throw new UserError("Piutang sudah lunas.");
    if (input.amount > debt.balance) {
      throw new UserError(
        `Pembayaran melebihi saldo (maks ${formatRupiah(debt.balance)}).`,
      );
    }

    await tx.insert(debtPayments).values({
      debtId: debt.id,
      businessId: actor.businessId,
      amount: input.amount,
      method: input.method,
      reference: input.reference ?? null,
      receivedBy: actor.userId,
    });

    const newBalance = debt.balance - input.amount;
    const status = newBalance === 0 ? "paid" : "open";
    await tx
      .update(debts)
      .set({ balance: newBalance, status })
      .where(eq(debts.id, debt.id));

    await writeAudit(tx, {
      businessId: actor.businessId,
      storeId: debt.storeId,
      actorId: actor.userId,
      action: "payment_received",
      entityType: "debt",
      entityId: debt.id,
      detail: `Terima pembayaran piutang ${formatRupiah(input.amount)} (${input.method}). Sisa ${formatRupiah(newBalance)}.`,
    });

    return { newBalance, status };
  });
}
