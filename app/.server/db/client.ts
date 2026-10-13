import { Pool } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

export type Db = NeonDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Satu pool per pemanggilan: koneksi WebSocket tidak boleh hidup
// lebih lama dari satu request di lingkungan serverless.
export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL belum diatur");
  }
  const pool = new Pool({ connectionString: url });
  try {
    return await fn(drizzle(pool, { schema }));
  } finally {
    await pool.end();
  }
}