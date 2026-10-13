import { data, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/produk-detail";
import { requireAdminStore } from "~/.server/auth/guards";
import { withDb } from "~/.server/db/client";
import { actionErrorFrom } from "~/.server/errors";
import {
  getProduct,
  listCategories,
  saveProduct,
} from "~/.server/services/catalog";
import { PageHeader } from "~/components/page-header";
import { ProductForm } from "~/components/product-form";
import {
  describeZodError,
  parseJson,
  productInputSchema,
} from "~/lib/schemas";

export function meta() {
  return [{ title: "Edit produk | POS JadikanWeb" }];
}

function parseId(value: string | undefined): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) {
    throw new Response("Produk tidak ditemukan", { status: 404 });
  }
  return parsed.data;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user, storeId } = await requireAdminStore(request);
  const id = parseId(params.id);

  const [found, categories] = await Promise.all([
    withDb((db) => getProduct(db, user.businessId, storeId, id)),
    withDb((db) => listCategories(db, user.businessId)),
  ]);

  if (!found) throw new Response("Produk tidak ditemukan", { status: 404 });
  return { ...found, categories };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user, storeId } = await requireAdminStore(request);
  const id = parseId(params.id);
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
        id,
        parsed.data,
      ),
    );
  } catch (err) {
    return actionErrorFrom(err, "SKU atau barcode sudah dipakai produk lain.");
  }

  return redirect("/produk");
}

export default function ProdukDetail({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { product, variants, categories } = loaderData;

  return (
    <>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="Edit produk"
          description={product.name}
          backTo="/produk"
        />
      </div>
      <ProductForm
        key={product.id}
        mode="edit"
        categories={categories}
        error={actionData?.error}
        initial={{
          name: product.name,
          categoryId: product.categoryId ?? "",
          isActive: product.isActive,
          hasVariants: variants.some((v) => !v.isDefault),
          variants: variants.map((v) => ({
            id: v.id,
            sku: v.sku,
            barcode: v.barcode ?? "",
            size: v.size ?? "",
            color: v.color ?? "",
            costPrice: String(v.costPrice),
            sellPrice: String(v.sellPrice),
            initialStock: "0",
            minQty: String(v.minQty),
            isActive: v.isActive,
            qty: v.qty,
          })),
        }}
      />
    </>
  );
}