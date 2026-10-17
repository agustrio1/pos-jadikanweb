import type { Route } from "./+types/api.search";
import { requireUser } from "~/.server/auth/session";
import { withDb } from "~/.server/db/client";
import { globalSearch } from "~/.server/services/search";

// Endpoint pencarian global untuk command palette (Ctrl/Cmd+K). Mengembalikan
// hasil tergrup per entitas. Butuh minimal 2 karakter; di bawah itu hasil kosong.
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request, { api: true });
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  const storeId = user.storeId;
  if (q.length < 2 || !storeId) {
    return Response.json({ groups: [] }, { headers: { "cache-control": "no-store" } });
  }
  const groups = await withDb((db) =>
    globalSearch(db, {
      businessId: user.businessId,
      storeId,
      q,
      role: user.role,
    }),
  );
  return Response.json({ groups }, { headers: { "cache-control": "no-store" } });
}
