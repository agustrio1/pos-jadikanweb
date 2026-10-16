import { and, asc, eq, ilike, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { suppliers } from "../db/schema";
import { UserError } from "../errors";

type Scope = { businessId: string };

function clean(value: string | null | undefined, max: number): string | null {
  const t = (value ?? "").trim();
  return t === "" ? null : t.slice(0, max);
}

export async function listSuppliers(db: Db, opts: Scope & { search?: string }) {
  const conditions = [eq(suppliers.businessId, opts.businessId)];
  const term = opts.search?.trim();
  if (term) {
    const like = `%${term}%`;
    const clause = or(ilike(suppliers.name, like), ilike(suppliers.phone, like));
    if (clause) conditions.push(clause);
  }
  return db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      phone: suppliers.phone,
      address: suppliers.address,
      createdAt: suppliers.createdAt,
    })
    .from(suppliers)
    .where(and(...conditions))
    .orderBy(asc(suppliers.name));
}

// Ringkasan untuk pemilih pemasok pada form PO.
export async function listSupplierOptions(db: Db, opts: Scope) {
  return db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.businessId, opts.businessId))
    .orderBy(asc(suppliers.name))
    .limit(2000);
}

export async function createSupplier(
  db: Db,
  scope: Scope,
  input: { name: string; phone?: string | null; address?: string | null },
): Promise<string> {
  const name = clean(input.name, 100);
  if (!name) throw new UserError("Nama pemasok wajib diisi.");
  const [row] = await db
    .insert(suppliers)
    .values({
      businessId: scope.businessId,
      name,
      phone: clean(input.phone, 32),
      address: clean(input.address, 200),
    })
    .returning({ id: suppliers.id });
  return row.id;
}

export async function updateSupplier(
  db: Db,
  scope: Scope,
  input: {
    id: string;
    name: string;
    phone?: string | null;
    address?: string | null;
  },
): Promise<void> {
  const name = clean(input.name, 100);
  if (!name) throw new UserError("Nama pemasok wajib diisi.");

  const [existing] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.id, input.id),
        eq(suppliers.businessId, scope.businessId),
      ),
    )
    .limit(1);
  if (!existing) throw new UserError("Pemasok tidak ditemukan.");

  await db
    .update(suppliers)
    .set({
      name,
      phone: clean(input.phone, 32),
      address: clean(input.address, 200),
    })
    .where(eq(suppliers.id, input.id));
}
