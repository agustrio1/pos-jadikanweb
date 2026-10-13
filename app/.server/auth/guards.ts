import { requireUser } from "./session";

// Semua halaman katalog dan stok: admin yang terikat ke toko.
export async function requireAdminStore(request: Request) {
  const user = await requireUser(request, { role: "admin" });
  if (!user.storeId) {
    throw new Response("Akun admin belum terikat ke toko.", { status: 400 });
  }
  return { user, storeId: user.storeId };
}