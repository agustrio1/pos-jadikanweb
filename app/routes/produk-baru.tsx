import { data, redirect } from "react-router";
import type { Route } from "./+types/produk-baru";
import { requireAdminStore } from "~/.server/auth/guards";
import { withDb } from "~/.server/db/client";
import { actionErrorFrom } from "~/.server/errors";
import { listCategories, saveProduct } from "~/.server/services/catalog";
import { PageHeader } from "~/components/page-header";
import { ProductForm } from "~/components/product-form";
import {
  describeZodError,
  parseJson,
  productInputSchema,
} from "~/lib/schemas";

export function meta() {
  return [{ title: "Tambah produk | POS JadikanWeb" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireAdminStore(request);
  const categories = await withDb((db) => listCategories(db, user.businessId));
  return { categories };
}

export async function action({ request }: Route.ActionArgs) {
  const { user, storeId } = await requireAdminStore(request);
  const form = await request.formData();
  const parsed = productInputSchema.safeParse(parseJson(form.get("payload")));

  if (!parsed.success) {
    return data({ error: describeZodError(parsed.error) }, { status: 400 });
  }

  try {
    await withDb((db) =>
      saveProduct(
        db,
        { businessId: user.businessId, storeId, userId: user.id },
        null,
        parsed.data,
      ),
    );
  } catch (err) {
    return actionErrorFrom(err, "SKU atau barcode sudah dipakai produk lain.");
  }

  return redirect("/produk");
}

export default function ProdukBaru({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return (
    <>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="Tambah produk"
          description="Isi data produk, harga, dan stok awal."
          backTo="/produk"
        />
      </div>
      <ProductForm
        mode="new"
        categories={loaderData.categories}
        error={actionData?.error}
      />
    </>
  );
}