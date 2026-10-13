import type { Route } from "./+types/stok-riwayat";
import { requireAdminStore } from "~/.server/auth/guards";
import { withDb } from "~/.server/db/client";
import { listMovements } from "~/.server/services/stock";
import { PageHeader } from "~/components/page-header";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { formatDateTime, variantLabel } from "~/lib/format";

export function meta() {
  return [{ title: "Riwayat stok | POS JadikanWeb" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user, storeId } = await requireAdminStore(request);
  const movements = await withDb((db) =>
    listMovements(db, user.businessId, storeId, 100),
  );
  return { movements };
}

const typeMeta: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  initial: { label: "Stok awal", variant: "secondary" },
  in: { label: "Masuk", variant: "secondary" },
  adjust: { label: "Penyesuaian", variant: "outline" },
  sale: { label: "Penjualan", variant: "default" },
  void: { label: "Pembatalan", variant: "destructive" },
};

export default function StokRiwayat({ loaderData }: Route.ComponentProps) {
  const { movements } = loaderData;

  return (
    <>
      <PageHeader
        title="Riwayat stok"
        description="100 pergerakan stok terbaru."
        backTo="/stok"
      />

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Waktu</TableHead>
                <TableHead>Produk</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead className="text-right">Perubahan</TableHead>
                <TableHead>Alasan</TableHead>
                <TableHead>Oleh</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-muted-foreground"
                  >
                    Belum ada pergerakan stok.
                  </TableCell>
                </TableRow>
              ) : (
                movements.map((m) => {
                  const label = variantLabel(m.size, m.color);
                  const meta = typeMeta[m.type] ?? {
                    label: m.type,
                    variant: "outline" as const,
                  };
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(m.createdAt)}
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{m.productName}</span>
                        {label ? (
                          <span className="text-muted-foreground">
                            {" "}
                            · {label}
                          </span>
                        ) : null}
                        <div className="text-xs text-muted-foreground">
                          {m.sku}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${
                          m.delta < 0 ? "text-destructive" : ""
                        }`}
                      >
                        {m.delta > 0 ? `+${m.delta}` : m.delta}
                      </TableCell>
                      <TableCell>{m.reason ?? "-"}</TableCell>
                      <TableCell>{m.userName ?? "-"}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}