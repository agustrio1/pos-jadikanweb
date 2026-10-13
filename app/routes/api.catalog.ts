import type { Route } from "./+types/api.catalog";
import { requireStoreUser } from "~/.server/auth/store-user";
import { withDb } from "~/.server/db/client";
import { getCatalogSnapshot } from "~/.server/services/catalog-snapshot";

export async function loader({ request }: Route.LoaderArgs) {
  const { user, storeId } = await requireStoreUser(request);
  const snapshot = await withDb((db) =>
    getCatalogSnapshot(db, { businessId: user.businessId, storeId }),
  );
  return Response.json(snapshot, {
    headers: { "Cache-Control": "no-store" },
  });
}