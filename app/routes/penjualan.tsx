import { Link } from "react-router";
import type { Route } from "./+types/penjualan";
import { requireStoreUser } from "~/.server/auth/store-user";
import { withDb } from "~/.server/db/client";
import { listSales } from "~/.server/services/sales";
import { PageHeader } from "~/components/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { formatDateTime, formatReceiptNo, formatRupiah } from "~/lib/format";

export function meta() {
  return [{ title: "Riwayat penjualan | POS JadikanWeb" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user, storeId } = await requireStoreUser(request);
  const isAdmin = user.role === "admin";

  const rows = await withDb((db) =>
    listSales(db, {
      businessId: user.businessId,
      storeId,
      cashierId: isAdmin ? undefined : user.id,
      limit: 100,
    }),
  );

  return { rows, isAdmin };
}

export default function Penjualan({ loaderData }: Route.ComponentProps) {
  const { rows, isAdmin } = loaderData;

  return (
    <>
      <PageHeader
        title="Riwayat penjualan"
        description={
          isAdmin
            ? "100 transaksi terbaru di toko ini."
            : "100 transaksi terbaru Anda."
        }
        actions={
          <Button asChild>
            <Link to="/kasir">Ke kasir</Link>
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No</TableHead>
                <TableHead>Waktu</TableHead>
                <TableHead>Kasir</TableHead>
                <TableHead className="text-right">Item</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Struk</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-muted-foreground"
                  >
                    Belum ada transaksi.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {formatReceiptNo(row.receiptNo)}
                      {row.status === "void" ? (
                        <Badge variant="destructive" className="ml-2">
                          Batal
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(row.soldAt)}
                    </TableCell>
                    <TableCell>{row.cashierName ?? "-"}</TableCell>
                    <TableCell className="text-right">{row.itemCount}</TableCell>
                    <TableCell className="text-right">
                      {formatRupiah(row.total)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/struk/${row.id}`}>Lihat</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}