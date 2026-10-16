import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import { auditAction, auditLogs, users } from "../db/schema";

// Nilai aksi yang diizinkan, diambil dari definisi enum agar selalu sinkron.
export type AuditAction = (typeof auditAction.enumValues)[number];

export type AuditEntry = {
  businessId: string;
  storeId?: string | null;
  actorId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  detail: string;
};

// Menyimpan satu jejak audit. Menerima Db atau Tx agar bisa dipanggil
// di dalam transaksi aksi aslinya — jejak audit ikut batal bila aksi gagal.
export async function writeAudit(
  db: Db | Tx,
  entry: AuditEntry,
): Promise<void> {
  await db.insert(auditLogs).values({
    businessId: entry.businessId,
    storeId: entry.storeId ?? null,
    actorId: entry.actorId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    detail: entry.detail,
  });
}

export type AuditFilter = {
  businessId: string;
  storeId?: string | null;
  action?: AuditAction;
  from: string;
  to: string;
  limit?: number;
};

// Mendaftarkan jejak audit untuk suatu bisnis dalam rentang tanggal
// (batas atas/ bawah berupa string YYYY-MM-DD, waktu Jakarta). Nama aktor
// di-join agar mudah dibaca walau user sudah dinonaktifkan/dihapus.
export async function listAudit(db: Db, opts: AuditFilter) {
  const conditions = [
    eq(auditLogs.businessId, opts.businessId),
    gte(auditLogs.createdAt, new Date(`${opts.from}T00:00:00+07:00`)),
    lte(auditLogs.createdAt, new Date(`${opts.to}T23:59:59.999+07:00`)),
  ];
  if (opts.storeId) conditions.push(eq(auditLogs.storeId, opts.storeId));
  if (opts.action) conditions.push(eq(auditLogs.action, opts.action));

  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      detail: auditLogs.detail,
      createdAt: auditLogs.createdAt,
      actorName: users.name,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(and(...conditions))
    .orderBy(desc(auditLogs.createdAt))
    .limit(opts.limit ?? 300);

  return rows;
}
