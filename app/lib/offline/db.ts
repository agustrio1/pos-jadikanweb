import Dexie, { type EntityTable } from "dexie";
import type { CatalogItem, OutboxSale } from "./types";

export type MetaRow = { key: string; value: unknown };

export type PosDatabase = Dexie & {
  catalog: EntityTable<CatalogItem, "variantId">;
  meta: EntityTable<MetaRow, "key">;
  outbox: EntityTable<OutboxSale, "clientId">;
};

let instance: PosDatabase | null = null;

// Dibuat malas (lazy) agar aman diimpor di server; IndexedDB hanya ada di browser.
export function getDb(): PosDatabase {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB tidak tersedia di lingkungan ini.");
  }
  if (!instance) {
    const db = new Dexie("pos-jadikanweb") as PosDatabase;
    db.version(1).stores({
      catalog: "variantId, productId, sku, barcode, name",
      meta: "key",
    });
    // v2 hanya menambah tabel outbox; data katalog v1 tetap utuh.
    db.version(2).stores({
      outbox: "clientId, status, createdAt",
    });
    instance = db;
  }
  return instance;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await getDb().meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await getDb().meta.put({ key, value });
}