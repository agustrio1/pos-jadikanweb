import { and, count, eq, gt, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { loginAttempts } from "../db/schema";

const WINDOW_MS = 15 * 60 * 1000;
const KEEP_MS = 24 * 60 * 60 * 1000;

// Batas percobaan gagal dalam satu jendela.
const MAX_PER_PAIR = 5; // username + IP yang sama
const MAX_PER_USER = 20; // satu username dari IP mana pun
const MAX_PER_IP = 30; // satu IP untuk username mana pun

// Kunci dari login.tsx berbentuk "username|ip".
function split(key: string) {
  const i = key.lastIndexOf("|");
  if (i === -1) return { user: key, ip: "unknown" };
  return { user: key.slice(0, i), ip: key.slice(i + 1) };
}

// Kunci pasangan selalu mengandung "|", jadi tidak bisa bentrok dengan
// dua kunci agregat ini.
const userKey = (user: string) => `user:${user}`;
const ipKey = (ip: string) => `ip:${ip}`;

async function recentCount(db: Db, key: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.key, key),
        gt(loginAttempts.createdAt, new Date(Date.now() - WINDOW_MS)),
      ),
    );
  return row?.n ?? 0;
}

export async function isBlocked(db: Db, key: string): Promise<boolean> {
  const { user, ip } = split(key);
  const [pair, byUser, byIp] = await Promise.all([
    recentCount(db, key),
    recentCount(db, userKey(user)),
    recentCount(db, ipKey(ip)),
  ]);
  return (
    pair >= MAX_PER_PAIR || byUser >= MAX_PER_USER || byIp >= MAX_PER_IP
  );
}

export async function recordFailure(db: Db, key: string): Promise<void> {
  const { user, ip } = split(key);
  await db
    .insert(loginAttempts)
    .values([{ key }, { key: userKey(user) }, { key: ipKey(ip) }]);
  // Bersihkan baris lama agar tabel tidak menumpuk.
  await db
    .delete(loginAttempts)
    .where(lt(loginAttempts.createdAt, new Date(Date.now() - KEEP_MS)));
}

// Login sukses hanya menghapus hitungan pasangan. Hitungan per username
// dan per IP dibiarkan kedaluwarsa sendiri, supaya penyerang tidak bisa
// mengulang hitungan dengan login ke akunnya sendiri.
export async function clearFailures(db: Db, key: string): Promise<void> {
  await db.delete(loginAttempts).where(eq(loginAttempts.key, key));
}