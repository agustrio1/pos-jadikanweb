import { Link } from "react-router";
import type { Route } from "./+types/home";
import { requireUser } from "~/.server/auth/session";
import { withDb } from "~/.server/db/client";
import { listVariants } from "~/.server/services/catalog";
import { PageHeader } from "~/components/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { formatRupiah, variantLabel } from "~/lib/format";

export function meta() {
  return [{ title: "Beranda | POS JadikanWeb" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);

  if (user.role !== "admin" || !user.storeId) {
    return { stats: null };
  }

  const storeId = user.storeId;
  const rows = await withDb((db) =>
    listVariants(db, { businessId: user.businessId, storeId }),
  );
  const low = rows.filter((row) => row.qty <= row.minQty);

  return {
    stats: {
      variants: rows.length,
      capped: rows.length >= 500,
      lowCount: low.length,
      stockValue: rows.reduce(
        (sum, row) => sum + Math.max(row.qty, 0) * row.costPrice,
        0,
      ),
      lowItems: low.slice(0, 5).map((row) => ({
        variantId: row.variantId,
        productName: row.productName,
        label: variantLabel(row.size, row.color),
        qty: row.qty,
        minQty: row.minQty,
      })),
    },
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { stats } = loaderData;

  const cashierButton = (
    <Button asChild>
      <Link to="/kasir">Buka kasir</Link>
    </Button>
  );

  if (!stats) {
    return (
      <>
        <PageHeader
          title="Beranda"
          description="Selamat datang."
          actions={cashierButton}
        />
        <Card>
          <CardHeader>
            <CardTitle>Kasir</CardTitle>
            <CardDescription>
              Mulai transaksi baru atau lihat riwayat penjualan Anda.
            </CardDescription>
          </CardHeader>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Beranda"
        description="Ringkasan katalog dan persediaan toko."
        actions={cashierButton}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Varian aktif</CardDescription>
            <CardTitle className="text-3xl">
              {stats.variants}
              {stats.capped ? "+" : ""}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Stok menipis</CardDescription>
            <CardTitle
              className={`text-3xl ${stats.lowCount > 0 ? "text-destructive" : ""}`}
            >
              {stats.lowCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Nilai persediaan (harga beli)</CardDescription>
            <CardTitle className="text-2xl">
              {formatRupiah(stats.stockValue)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="space-y-1">
            <CardTitle>Perlu restok</CardTitle>
            <CardDescription>Lima item dengan stok paling menipis.</CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/stok?low=1">Lihat semua</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {stats.lowItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Semua stok aman.</p>
          ) : (
            <ul className="divide-y">
              {stats.lowItems.map((item) => (
                <li
                  key={item.variantId}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span>
                    {item.productName}
                    {item.label ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {item.label}
                      </span>
                    ) : null}
                  </span>
                  <Badge variant="destructive">
                    {item.qty} / min {item.minQty}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}