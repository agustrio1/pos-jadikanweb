import { requireUser } from "~/.server/auth/session";

export async function requireStoreUser(request: Request) {
  const user = await requireUser(request);
  if (!user.storeId) {
    throw new Response("Akun belum terhubung ke toko.", { status: 403 });
  }
  return { user, storeId: user.storeId };
}