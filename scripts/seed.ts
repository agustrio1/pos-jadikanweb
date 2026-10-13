import { eq } from "drizzle-orm";
import { hashPassword } from "../app/.server/auth/password";
import { withDb } from "../app/.server/db/client";
import { businesses, stores, users } from "../app/.server/db/schema";

function need(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Env ${name} belum diatur`);
    process.exit(1);
  }
  return value;
}

const businessName = need("SEED_BUSINESS_NAME");
const storeName = need("SEED_STORE_NAME");
const adminName = need("SEED_ADMIN_NAME");
const username = need("SEED_ADMIN_USERNAME").toLowerCase();
const password = need("SEED_ADMIN_PASSWORD");

if (password.length < 8) {
  console.error("SEED_ADMIN_PASSWORD minimal 8 karakter");
  process.exit(1);
}

await withDb(async (db) => {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (existing.length > 0) {
    console.log("Admin sudah ada, seed dilewati.");
    return;
  }

  const passwordHash = await hashPassword(password);

  await db.transaction(async (tx) => {
    const [business] = await tx
      .insert(businesses)
      .values({ name: businessName })
      .returning({ id: businesses.id });

    const [store] = await tx
      .insert(stores)
      .values({ businessId: business.id, name: storeName })
      .returning({ id: stores.id });

    await tx.insert(users).values({
      businessId: business.id,
      storeId: store.id,
      username,
      passwordHash,
      name: adminName,
      role: "admin",
      maxDiscountPct: 100,
    });
  });

  console.log("Seed selesai.");
});