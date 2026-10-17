import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import { barcodeSequences, productVariants } from "../db/schema";
import { UserError } from "../errors";

// Awalan distribusi-internal. Rentang GS1 "2" (20-29) khusus pemakaian di
// dalam toko, jadi 200 ... aman tanpa menabrak barcode ritel resmi.
const EAN13_PREFIX = "200";

// Digit periksa EAN-13 dari 12 digit pertama (bobot 1,3 berulang dari kiri).
export function ean13CheckDigit(twelve: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = twelve.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  return (10 - (sum % 10)) % 10;
}

// Rangkai nomor urut menjadi kode EAN-13 13 digit (prefix + urut + check).
function buildEan13(serial: number): string {
  const base = (EAN13_PREFIX + String(serial).padStart(9, "0")).slice(0, 12);
  return base + String(ean13CheckDigit(base));
}

// Naikkan penghitung per bisnis dan kembalikan kode EAN-13 berikutnya.
// Upsert atomik: baris dibuat (1) bila belum ada, bila ada nilainya +1.
async function nextSerial(tx: Tx, businessId: string): Promise<number> {
  const [row] = await tx
    .insert(barcodeSequences)
    .values({ businessId, lastValue: 1 })
    .onConflictDoUpdate({
      target: barcodeSequences.businessId,
      set: { lastValue: sql`${barcodeSequences.lastValue} + 1` },
    })
    .returning({ lastValue: barcodeSequences.lastValue });
  return row.lastValue;
}

// Buat kode EAN-13 yang dijamin belum dipakai varian lain pada bisnis yang
// sama (barcode bisa saja pernah diisi manual dengan angka yang bentrok).
export async function generateBarcode(
  tx: Tx,
  businessId: string,
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = buildEan13(await nextSerial(tx, businessId));
    const [clash] = await tx
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(
        and(
          eq(productVariants.businessId, businessId),
          eq(productVariants.barcode, code),
        ),
      )
      .limit(1);
    if (!clash) return code;
  }
  throw new UserError("Gagal membuat barcode otomatis. Coba lagi.");
}

// Buat satu barcode EAN-13 di luar transaksi pembuatan produk (dipakai tombol
// "Buat otomatis" pada form produk). Menjalankan transaksinya sendiri.
export function generateBarcodeOnce(
  db: Db,
  businessId: string,
): Promise<string> {
  return db.transaction((tx) => generateBarcode(tx, businessId));
}

// Isikan barcode EAN-13 ke semua varian milik bisnis yang belum punya.
// Mengembalikan berapa varian yang terisi. Berjalan dalam satu transaksi.
export async function backfillMissingBarcodes(
  db: Db,
  businessId: string,
): Promise<number> {
  return db.transaction(async (tx) => {
    const missing = await tx
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(
        and(
          eq(productVariants.businessId, businessId),
          isNull(productVariants.barcode),
        ),
      );

    let count = 0;
    for (const { id } of missing) {
      const code = await generateBarcode(tx, businessId);
      await tx
        .update(productVariants)
        .set({ barcode: code })
        .where(eq(productVariants.id, id));
      count++;
    }
    return count;
  });
}
