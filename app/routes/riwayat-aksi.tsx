import { Form } from "react-router";
import type { Route } from "./+types/riwayat-aksi";
import { requireUser } from "~/.server/auth/session";
import { withDb } from "~/.server/db/client";
import { listAudit } from "~/.server/services/audit";
import type { AuditAction } from "~/.server/services/audit";
import { parseRange } from "~/.server/services/reports";
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
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

export function meta() {
  return [{ title: "Riwayat Aksi | POS JadikanWeb" }];
}

// Label aksi dalam Bahasa Indonesia. Sekaligus jadi daftar pilihan filter,
// sehingga tidak perlu mengimpor enum server ke bundel client.
const ACTION_LABEL: Record<AuditAction, string> = {
  void_sale: "Batal penuh",
  return_sale: "Retur",
  price_change: "Ubah harga",
  discount_override: "Override diskon",
  user_create: "Tambah pengguna",
  user_update: "Ubah pengguna",
  user_disable: "Nonaktifkan pengguna",
  password_reset: "Reset sandi",
  store_create: "Tambah toko",
  store_update: "Ubah toko",
  stock_adjust: "Koreksi stok",
  shift_close: "Tutup shift",
  payment_received: "Terima pembayaran",
};

// Warna badge per kategori aksi agar mudah dipindai.
const ACTION_TONE: Record<AuditAction, "destructive" | "secondary" | "outline"> =
  {
    void_sale: "destructive",
    return_sale: "destructive",
    user_disable: "destructive",
    password_reset: "destructive",
    price_change: "secondary",
    discount_override: "secondary",
    stock_adjust: "secondary",
    store_update: "secondary",
    user_update: "secondary",
    shift_close: "secondary",
    user_create: "outline",
    store_create: "outline",
    payment_received: "outline",
  };

const ACTIONS = Object.keys(ACTION_LABEL) as AuditAction[];

const timestampFormat = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

export async function loader({ request }: Route.LoaderArgs) {
  // Cakupan bisnis (lintas toko), khusus admin.
  const user = await requireUser(request, { role: "admin" });
  const url = new URL(request.url);
  const { range } = parseRange(
    url.searchParams.get("from"),
    url.searchParams.get("to"),
  );
  const raw = url.searchParams.get("action");
  const action =
    raw && (ACTIONS as string[]).includes(raw) ? (raw as AuditAction) : undefined;

  const rows = await withDb((db) =>
    listAudit(db, {
      businessId: user.businessId,
      from: range.from,
      to: range.to,
      action,
    }),
  );

  return {
    from: range.from,
    to: range.to,
    action: action ?? "",
    rows,
  };
}

export default function RiwayatAksi({
  loaderData,
}: Route.ComponentProps) {
  const { from, to, action, rows } = loaderData;

  return (
    <>
      <PageHeader
        title="Riwayat Aksi"
        description="Jejak tindakan penting: pembatalan, retur, ubah harga, koreksi stok, dan pengelolaan pengguna/toko."
      />

      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
          <CardDescription>
            Menampilkan hingga 300 entri terbaru dalam rentang terpilih.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="get" className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="from">Dari</Label>
              <Input id="from" name="from" type="date" defaultValue={from} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">Sampai</Label>
              <Input id="to" name="to" type="date" defaultValue={to} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="action">Jenis aksi</Label>
              <select
                id="action"
                name="action"
                defaultValue={action}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Semua aksi</option>
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {ACTION_LABEL[a]}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" size="sm">
              Terapkan
            </Button>
          </Form>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardContent className="p-0 pt-6">
          {rows.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              Belum ada aktivitas pada rentang ini.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Aksi</TableHead>
                  <TableHead>Aktor</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {timestampFormat.format(row.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={ACTION_TONE[row.action]}>
                        {ACTION_LABEL[row.action]}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {row.actorName ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">{row.detail}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
