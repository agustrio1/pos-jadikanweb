import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { withDb } from "../app/.server/db/client";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL belum diatur");
  process.exit(1);
}

// Hanya host yang ditampilkan, tidak ada username atau password.
console.log(`Target database: ${new URL(url).host}`);

if (process.env.CONFIRM_MIGRATE !== "yes" && !process.argv.includes("--yes")) {
  console.error(
    "Periksa host di atas. Jika benar, jalankan ulang dengan --yes " +
      "(atau set CONFIRM_MIGRATE=yes).",
  );
  process.exit(1);
}

try {
  await withDb((db) => migrate(db, { migrationsFolder: "./drizzle" }));
  console.log("Migrasi selesai.");
} catch (err) {
  console.error("Migrasi gagal:", err);
  process.exit(1);
}