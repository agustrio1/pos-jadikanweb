import type { Route } from "./+types/api.barcode";
import { requireAdminStore } from "~/.server/auth/guards";
import { withDb } from "~/.server/db/client";
import { generateBarcodeOnce } from "~/.server/services/barcodes";

// Menyediakan satu kode EAN-13 baru untuk tombol "Buat otomatis" di form produk.
// Hanya admin; menaikkan penghitung per bisnis agar kode dijamin unik.
export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireAdminStore(request);
  const code = await withDb((db) => generateBarcodeOnce(db, user.businessId));
  return Response.json({ code }, { headers: { "Cache-Control": "no-store" } });
}
