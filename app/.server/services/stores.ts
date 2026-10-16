import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { stores } from "../db/schema";
import { UserError } from "../errors";
import { writeAudit } from "./audit";

type Actor = { businessId: string; userId: string };

export async function listStores(db: Db, businessId: string) {
  return db
    .select({
      id: stores.id,
      name: stores.name,
      address: stores.address,
      lastReceiptNo: stores.lastReceiptNo,
      createdAt: stores.createdAt,
    })
    .from(stores)
    .where(eq(stores.businessId, businessId))
    .orderBy(stores.name);
}

export async function createStore(db: Db, actor: Actor, name: string) {
  const [row] = await db
    .insert(stores)
    .values({ businessId: actor.businessId, name })
    .returning({ id: stores.id });
  await writeAudit(db, {
    businessId: actor.businessId,
    storeId: row.id,
    actorId: actor.userId,
    action: "store_create",
    entityType: "store",
    entityId: row.id,
    detail: `Buat toko "${name}".`,
  });
  return row.id;
}

export async function updateStore(
  db: Db,
  actor: Actor,
  input: { storeId: string; name: string; address: string | null },
) {
  const [target] = await db
    .select({ id: stores.id })
    .from(stores)
    .where(and(eq(stores.id, input.storeId), eq(stores.businessId, actor.businessId)))
    .limit(1);
  if (!target) throw new UserError("Toko tidak ditemukan.");

  await db
    .update(stores)
    .set({ name: input.name, address: input.address })
    .where(eq(stores.id, input.storeId));

  await writeAudit(db, {
    businessId: actor.businessId,
    storeId: input.storeId,
    actorId: actor.userId,
    action: "store_update",
    entityType: "store",
    entityId: input.storeId,
    detail: `Perbarui toko "${input.name}".`,
  });
}
