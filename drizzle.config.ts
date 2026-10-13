import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL belum diatur");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./app/.server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});