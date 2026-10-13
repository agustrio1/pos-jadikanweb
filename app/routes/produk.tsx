import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { Form, Link } from "react-router";
import type { Route } from "./+types/produk";
import { requireAdminStore } from "~/.server/auth/guards";
import { withDb } from "~/.server/db/client";
import { listVariants } from "~/.server/services/catalog";
import { PageHeader } from "~/components/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { formatRupiah, variantLabel } from "~/lib/format";

export function meta() {
  return [{ title: "Produk | POS JadikanWeb" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user, storeId } = await requireAdminStore(request);
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const low = url.searchParams.get("low") === "1";

  const rows = await withDb((db) =>
    listVariants(db, {
      businessId: user.businessId,
      storeId,
      q: q || undefined,
      low,
      includeInactive: true,
    }),
  );

  return { rows, q, low };
}

export default function Produk({ loaderData }: Route.ComponentProps) {
  const { rows, q, low } = loaderData;

  const href = (lowOnly: boolean) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (lowOnly) params.set("low", "1");
    const query = params.toString();
    return query ? `/produk?${query}` : "/produk";
  };

  return (
    <>
      <PageHeader
        title="Produk"
        description="Kelola produk, varian, harga, dan SKU."
        actions={
          <Button asChild>
            <Link to="/produk/baru">
              <HugeiconsIcon icon={Add01Icon} />
              Tambah produk
            </Link>
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b p-3">
          <Form method="get" className="relative min-w-52 flex-1">
            <HugeiconsIcon
              icon={Search01Icon}
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              name="q"
              defaultValue={q}
              placeholder="Cari nama, SKU, atau barcode"
              className="pl-9"
            />
            {low ? <input type="hidden" name="low" value="1" /> : null}
          </Form>

          <div className="flex gap-1">
            <Button variant={low ? "outline" : "default"} size="sm" asChild>
              <Link to={href(false)}>Semua</Link>
            </Button>
            <Button variant={low ? "default" : "outline"} size="sm" asChild>
              <Link to={href(true)}>Stok menipis</Link>
            </Button>
          </div>
        </div>

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produk</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Harga jual</TableHead>
                <TableHead className="text-right">Stok</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-10 text-center text-muted-foreground"
                  >
                    Tidak ada produk.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const label = variantLabel(row.size, row.color);
                  const isLow = row.qty <= row.minQty;
                  const inactive = !row.productActive || !row.variantActive;

                  return (
                    <TableRow key={row.variantId}>
                      <TableCell>
                        <Link
                          to={`/produk/${row.productId}`}
                          className="font-medium hover:underline"
                        >
                          {row.productName}
                        </Link>
                        {label ? (
                          <span className="text-muted-foreground">
                            {" "}
                            · {label}
                          </span>
                        ) : null}
                        <div className="mt-0.5 flex items-center gap-1.5">
                          {row.categoryName ? (
                            <span className="text-xs text-muted-foreground">
                              {row.categoryName}
                            </span>
                          ) : null}
                          {inactive ? (
                            <Badge variant="secondary">Nonaktif</Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.sku}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatRupiah(row.sellPrice)}
                      </TableCell>
                      <TableCell className="text-right">
                        {isLow ? (
                          <Badge variant="destructive">{row.qty}</Badge>
                        ) : (
                          row.qty
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {rows.length === 500 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Menampilkan 500 baris pertama. Persempit dengan pencarian.
        </p>
      ) : null}
    </>
  );
}