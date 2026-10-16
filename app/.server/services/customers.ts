import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { customers, debts, sales, users } from "../db/schema";
import { UserError } from "../errors";

type Scope = { businessId: string };

function cleanPhone(value: string | null | undefined): string | null {
  const t = (value ?? "").trim();
  return t === "" ? null : t.slice(0, 32);
}

// Mencegah nomor HP ganda dalam satu bisnis dengan pesan ramah (bukan error DB).
async function assertPhoneFree(
  db: Db,
  businessId: string,
  phone: string,
  excludeId: string | null,
) {
  const [found] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(
      and(
        eq(customers.businessId, businessId),
        eq(customers.phone, phone),
      ),
    )
    .limit(1);
  if (found && found.id !== excludeId) {
    throw new UserError("Nomor HP sudah dipakai pelanggan lain.");
  }
}

export async function listCustomers(db: Db, opts: Scope & { search?: string }) {
  const conditions = [eq(customers.businessId, opts.businessId)];
  const term = opts.search?.trim();
  if (term) {
    const like = `%${term}%`;
    const clause = or(ilike(customers.name, like), ilike(customers.phone, like));
    if (clause) conditions.push(clause);
  }

  return db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      points: customers.points,
      tier: customers.tier,
      // Saldo piutang terbuka (bukan riwayat), untuk tampilan daftar.
      debtBalance:
        sql<number>`coalesce((select sum(${debts.balance}) from ${debts} where ${debts.customerId} = ${customers.id} and ${debts.status} = 'open'), 0)`.mapWith(
          Number,
        ),
    })
    .from(customers)
    .where(and(...conditions))
    .orderBy(desc(customers.createdAt))
    .limit(500);
}

// Ringkasan ringan untuk pemilih pelanggan di kasir (hanya kolom yang perlu).
export async function listCustomerOptions(db: Db, opts: Scope) {
  return db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      points: customers.points,
    })
    .from(customers)
    .where(eq(customers.businessId, opts.businessId))
    .orderBy(customers.name)
    .limit(2000);
}

export async function createCustomer(
  db: Db,
  scope: Scope,
  input: { name: string; phone?: string | null; tier?: string | null },
): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new UserError("Nama pelanggan wajib diisi.");
  const phone = cleanPhone(input.phone);
  const tier = (input.tier ?? "").trim().slice(0, 40) || null;
  if (phone) await assertPhoneFree(db, scope.businessId, phone, null);

  const [row] = await db
    .insert(customers)
    .values({ businessId: scope.businessId, name, phone, tier })
    .returning({ id: customers.id });
  return row.id;
}

export async function updateCustomer(
  db: Db,
  scope: Scope,
  input: {
    id: string;
    name: string;
    phone?: string | null;
    tier?: string | null;
  },
): Promise<void> {
  const name = input.name.trim();
  if (!name) throw new UserError("Nama pelanggan wajib diisi.");
  const phone = cleanPhone(input.phone);
  const tier = (input.tier ?? "").trim().slice(0, 40) || null;

  const [existing] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(
      and(
        eq(customers.id, input.id),
        eq(customers.businessId, scope.businessId),
      ),
    )
    .limit(1);
  if (!existing) throw new UserError("Pelanggan tidak ditemukan.");
  if (phone) await assertPhoneFree(db, scope.businessId, phone, input.id);

  await db
    .update(customers)
    .set({ name, phone, tier })
    .where(eq(customers.id, input.id));
}

export async function getCustomerDetail(db: Db, scope: Scope & { id: string }) {
  const [customer] = await db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      points: customers.points,
      tier: customers.tier,
      createdAt: customers.createdAt,
    })
    .from(customers)
    .where(
      and(
        eq(customers.id, scope.id),
        eq(customers.businessId, scope.businessId),
      ),
    )
    .limit(1);
  if (!customer) return null;

  const [openDebt] = await db
    .select({
      balance:
        sql<number>`coalesce(sum(${debts.balance}), 0)`.mapWith(Number),
    })
    .from(debts)
    .where(
      and(eq(debts.customerId, customer.id), eq(debts.status, "open")),
    );

  const recentSales = await db
    .select({
      id: sales.id,
      receiptNo: sales.receiptNo,
      soldAt: sales.soldAt,
      total: sales.total,
      status: sales.status,
      cashierName: users.name,
    })
    .from(sales)
    .leftJoin(users, eq(users.id, sales.cashierId))
    .where(and(eq(sales.customerId, customer.id), eq(sales.businessId, scope.businessId)))
    .orderBy(desc(sales.soldAt))
    .limit(15);

  const openDebts = await db
    .select({
      id: debts.id,
      saleId: debts.saleId,
      amount: debts.amount,
      balance: debts.balance,
      dueDate: debts.dueDate,
      createdAt: debts.createdAt,
      receiptNo: sales.receiptNo,
    })
    .from(debts)
    .leftJoin(sales, eq(sales.id, debts.saleId))
    .where(
      and(eq(debts.customerId, customer.id), eq(debts.status, "open")),
    )
    .orderBy(desc(debts.createdAt));

  return {
    customer,
    outstanding: openDebt?.balance ?? 0,
    recentSales,
    openDebts,
  };
}
