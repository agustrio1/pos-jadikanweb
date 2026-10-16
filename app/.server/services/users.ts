import { and, count, eq, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { sessions, stores, users } from "../db/schema";
import { hashPassword } from "../auth/password";
import { UserError } from "../errors";
import { writeAudit } from "./audit";

type Actor = { businessId: string; userId: string };

export async function listUsers(db: Db, businessId: string) {
  return db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      role: users.role,
      maxDiscountPct: users.maxDiscountPct,
      isActive: users.isActive,
      storeId: users.storeId,
      storeName: stores.name,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(stores, eq(stores.id, users.storeId))
    .where(eq(users.businessId, businessId))
    .orderBy(sql`${users.isActive} desc`, users.username);
}

export async function getUserById(db: Db, businessId: string, userId: string) {
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      role: users.role,
      maxDiscountPct: users.maxDiscountPct,
      isActive: users.isActive,
      storeId: users.storeId,
    })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.businessId, businessId)))
    .limit(1);
  return row ?? null;
}

// storeId (kalau diisi) harus milik bisnis actor.
async function assertStoreInBusiness(txDb: Db, businessId: string, storeId: string | null) {
  if (!storeId) return;
  const [store] = await txDb
    .select({ id: stores.id })
    .from(stores)
    .where(and(eq(stores.id, storeId), eq(stores.businessId, businessId)))
    .limit(1);
  if (!store) throw new UserError("Toko tidak ditemukan di bisnis ini.");
}

export async function createUser(
  db: Db,
  actor: Actor,
  input: {
    username: string;
    name: string;
    role: "admin" | "kasir";
    storeId: string | null;
    password: string;
    maxDiscountPct: number;
  },
) {
  await assertStoreInBusiness(db, actor.businessId, input.storeId);
  const passwordHash = await hashPassword(input.password);
  const [row] = await db
    .insert(users)
    .values({
      businessId: actor.businessId,
      username: input.username,
      name: input.name,
      role: input.role,
      storeId: input.storeId,
      passwordHash,
      // Batas diskon tidak berlaku bagi admin (selalu leluasa seperti void).
      maxDiscountPct: input.role === "admin" ? 100 : input.maxDiscountPct,
    })
    .returning({ id: users.id });
  await writeAudit(db, {
    businessId: actor.businessId,
    actorId: actor.userId,
    action: "user_create",
    entityType: "user",
    entityId: row.id,
    detail: `Buat pengguna ${input.username} (role ${input.role}).`,
  });
  return row.id;
}

export async function updateUser(
  db: Db,
  actor: Actor,
  input: {
    userId: string;
    name: string;
    role: "admin" | "kasir";
    storeId: string | null;
    maxDiscountPct: number;
  },
) {
  const target = await getUserById(db, actor.businessId, input.userId);
  if (!target) throw new UserError("Pengguna tidak ditemukan.");
  await assertStoreInBusiness(db, actor.businessId, input.storeId);

  // Edit diri sendiri ditolak total: role/toko milik akun aktif menentukan
  // jalannya sinkronisasi dan otorisasi, jadi hanya boleh diubah akun lain.
  if (actor.userId === input.userId) {
    throw new UserError("Anda tidak dapat mengubah akun sendiri.");
  }

  await db
    .update(users)
    .set({
      name: input.name,
      role: input.role,
      storeId: input.storeId,
      maxDiscountPct: input.role === "admin" ? 100 : input.maxDiscountPct,
    })
    .where(and(eq(users.id, input.userId), eq(users.businessId, actor.businessId)));

  await writeAudit(db, {
    businessId: actor.businessId,
    actorId: actor.userId,
    action: "user_update",
    entityType: "user",
    entityId: input.userId,
    detail: `Perbarui pengguna ${target.username} (role ${input.role}).`,
  });
}

// Nonaktifkan/aktifkan kembali. Menonaktifkan menghapus sesi aktif user itu
// (getUser sudah menolak user nonaktif, tetapi baris sesi dibersihkan agar
// token curian benar-benar mati). Guard: akun sendiri dan admin aktif terakhir.
export async function setActiveUser(
  db: Db,
  actor: Actor,
  input: { userId: string; active: boolean },
) {
  const target = await getUserById(db, actor.businessId, input.userId);
  if (!target) throw new UserError("Pengguna tidak ditemukan.");
  if (!input.active) {
    if (actor.userId === input.userId) {
      throw new UserError("Anda tidak dapat menonaktifkan akun sendiri.");
    }
    if (target.role === "admin" && target.isActive) {
      const [others] = await db
        .select({ n: count() })
        .from(users)
        .where(
          and(
            eq(users.businessId, actor.businessId),
            eq(users.role, "admin"),
            eq(users.isActive, true),
            ne(users.id, input.userId),
          ),
        );
      if ((others?.n ?? 0) === 0) {
        throw new UserError("Harus ada minimal satu admin aktif di bisnis ini.");
      }
    }
  }

  await db
    .update(users)
    .set({ isActive: input.active })
    .where(and(eq(users.id, input.userId), eq(users.businessId, actor.businessId)));

  if (!input.active) {
    await db.delete(sessions).where(eq(sessions.userId, input.userId));
  }

  await writeAudit(db, {
    businessId: actor.businessId,
    actorId: actor.userId,
    action: input.active ? "user_update" : "user_disable",
    entityType: "user",
    entityId: input.userId,
    detail: `${input.active ? "Aktifkan kembali" : "Nonaktifkan"} pengguna ${target.username}.`,
  });
}

// Reset password oleh admin = putus sesi lama user tersebut. Sengaja: token
// lama tetap valid di tabel sessions, jadi tidak boleh dibiarkan setelah
// kredensial berubah.
export async function resetUserPassword(
  db: Db,
  actor: Actor,
  input: { userId: string; password: string },
) {
  const target = await getUserById(db, actor.businessId, input.userId);
  if (!target) throw new UserError("Pengguna tidak ditemukan.");
  const passwordHash = await hashPassword(input.password);
  await db
    .update(users)
    .set({ passwordHash })
    .where(and(eq(users.id, input.userId), eq(users.businessId, actor.businessId)));
  await db.delete(sessions).where(eq(sessions.userId, input.userId));

  await writeAudit(db, {
    businessId: actor.businessId,
    actorId: actor.userId,
    action: "password_reset",
    entityType: "user",
    entityId: input.userId,
    detail: `Reset password pengguna ${target.username}.`,
  });
}
