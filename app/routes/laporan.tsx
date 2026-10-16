import { Form, Link } from "react-router";
import type { Route } from "./+types/laporan";
import { requireAdminStore } from "~/.server/auth/guards";
import { withDb } from "~/.server/db/client";
import { outstandingSummary, topDebtors } from "~/.server/services/debts";
import {
  getInventoryReport,
  getSalesReport,
  parseRange,
  rangePresets,
} from "~/.server/services/reports";
import { PageHeader } from "~/components/page-header";
import { Alert, AlertDescription } from "~/components/ui/alert";
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
import { formatRupiah, variantLabel } from "~/lib/format";

export function meta() {
  return [{ title: "Laporan | POS JadikanWeb" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user, storeId } = await requireAdminStore(request);
  const url = new URL(request.url);
  const { range, note } = parseRange(
    url.searchParams.get("from"),
    url.searchParams.get("to"),
  );
  const scope = { businessId: user.businessId, storeId };

  const [report, stock, debtTotal, debtTop] = await withDb((db) =>
    Promise.all([
      getSalesReport(db, { ...scope, range }),
      getInventoryReport(db, scope),
      outstandingSummary(db, { businessId: user.businessId }),
      topDebtors(db, { businessId: user.businessId }),
    ]),
  );

  return {
    from: range.from,
    to: range.to,
    note,
    presets: rangePresets(),
    report,
    stock,
    debt: { total: debtTotal, top: debtTop },
  };
}

const dayFormat = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeZone: "UTC",
});
const dayLabel = (day: string) => dayFormat.format(new Date(`${day}T00:00:00Z`));

const METHOD_LABEL: Record<string, string> = {
  cash: "Tunai",
  qris: "QRIS",
  debit: "Debit",
  credit: "Kredit",
};

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      {hint ? (
        <CardContent className="text-xs text-muted-foreground">
          {hint}
        </CardContent>
      ) : null}
    </Card>
  );
}

export default function Laporan({ loaderData }: Route.ComponentProps) {
  const { from, to, note, presets, report, stock, debt } = loaderData;
  const { totals } = report;
  const average = totals.count > 0 ? Math.floor(totals.revenue / totals.count) : 0;
  const { summary } = stock;
  const maxHourCount = report.byHour.reduce(
    (max, row) => Math.max(max, row.count),
    0,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Laporan"
        description="Penjualan, persediaan, dan status sinkronisasi toko ini. Hanya transaksi yang tidak dibatalkan yang dihitung."
      />

      <Card>
        <CardContent className="space-y-3 pt-6">
          <Form method="get" className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="from">Dari</Label>
              <Input id="from" name="from" type="date" defaultValue={from} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">Sampai</Label>
              <Input id="to" name="to" type="date" defaultValue={to} required />
            </div>
            <Button type="submit">Terapkan</Button>
          </Form>
          <div className="flex flex-wrap gap-1">
            {presets.map((preset) => (
              <Button key={preset.label} variant="outline" size="sm" asChild>
                <Link to={`/laporan?from=${preset.from}&to=${preset.to}`}>
                  {preset.label}
                </Link>
              </Button>
            ))}
          </div>
          {note ? (
            <Alert>
              <AlertDescription>{note}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Penjualan</h2>
          <Button variant="outline" size="sm" asChild>
            <a href={`/laporan/csv?from=${from}&to=${to}`}>Unduh CSV</a>
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Stat label="Omzet" value={formatRupiah(totals.revenue)} hint="Total setelah diskon." />
          <Stat label="Transaksi" value={String(totals.count)} hint={`Rata-rata ${formatRupiah(average)} per transaksi.`} />
          <Stat label="Laba kotor" value={formatRupiah(totals.profit)} hint="Omzet dikurangi harga beli saat transaksi." />
          <Stat label="Diskon diberikan" value={formatRupiah(totals.discount)} />
          <Stat
            label="PPN 11% (termasuk)"
            value={formatRupiah(totals.tax)}
            hint="Bagian PPN yang terangkum dalam omzet barang kena pajak."
          />
          <Stat
            label="Dibatalkan"
            value={`${totals.voidCount} transaksi`}
            hint={`Senilai ${formatRupiah(totals.voidTotal)}. Tidak masuk omzet.`}
          />
        </div>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Per hari</CardTitle>
            <CardDescription>
              Hari dihitung menurut waktu Jakarta, berdasarkan waktu transaksi.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tanggal</TableHead>
                  <TableHead className="text-right">Transaksi</TableHead>
                  <TableHead className="text-right">Omzet</TableHead>
                  <TableHead className="text-right">Diskon</TableHead>
                  <TableHead className="text-right">PPN</TableHead>
                  <TableHead className="text-right">Laba kotor</TableHead>
                  <TableHead className="text-right">Batal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.days.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      Tidak ada transaksi pada rentang ini.
                    </TableCell>
                  </TableRow>
                ) : (
                  report.days.map((day) => (
                    <TableRow key={day.day}>
                      <TableCell className="whitespace-nowrap font-medium">{dayLabel(day.day)}</TableCell>
                      <TableCell className="text-right">{day.count}</TableCell>
                      <TableCell className="text-right">{formatRupiah(day.revenue)}</TableCell>
                      <TableCell className="text-right">{formatRupiah(day.discount)}</TableCell>
                      <TableCell className="text-right">{formatRupiah(day.tax)}</TableCell>
                      <TableCell className="text-right">{formatRupiah(day.profit)}</TableCell>
                      <TableCell className="text-right">{day.voidCount}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Piutang beredar</CardTitle>
            <CardDescription>
              Rekap tingkat bisnis (lintas toko): total saldo piutang terbuka
              dan pelanggan terbesar. Terhitung dari transaksi metode Kredit.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-2xl font-semibold">
                {formatRupiah(debt.total.total)}
              </span>
              <span className="text-sm text-muted-foreground">
                dari {debt.total.count} piutang terbuka
              </span>
            </div>
            {debt.top.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Tidak ada piutang beredar.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pelanggan</TableHead>
                    <TableHead className="text-right">Transaksi</TableHead>
                    <TableHead className="text-right">Sisa piutang</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {debt.top.map((row) => (
                    <TableRow key={row.customerId}>
                      <TableCell>
                        <Link
                          to={`/pelanggan?id=${row.customerId}`}
                          className="hover:underline"
                        >
                          {row.customerName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">{row.count}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatRupiah(row.balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Padatan jam</CardTitle>
              <CardDescription>
                Jumlah transaksi per jam (waktu Jakarta). Menunjukkan jam sibuk
                toko ini.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {report.byHour.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Tidak ada transaksi pada rentang ini.
                </p>
              ) : (
                report.byHour.map((row) => (
                  <div key={row.hour} className="flex items-center gap-2 text-sm">
                    <span className="w-12 tabular-nums text-muted-foreground">
                      {row.hour}:00
                    </span>
                    <div className="h-4 flex-1 rounded bg-muted">
                      <div
                        className="h-full rounded bg-primary/70"
                        style={{
                          width: `${maxHourCount > 0 ? Math.round((row.count / maxHourCount) * 100) : 0}%`,
                        }}
                      />
                    </div>
                    <span className="w-8 text-right tabular-nums">{row.count}</span>
                    <span className="w-24 text-right tabular-nums text-muted-foreground">
                      {formatRupiah(row.revenue)}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Per kasir</CardTitle>
              <CardDescription>
                Dipakai sebagai sinyal kontrol, bukan papan peringkat. Rata-rata
                diskon membantu mengawasi kewenangan.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kasir</TableHead>
                    <TableHead className="text-right">Transaksi</TableHead>
                    <TableHead className="text-right">Omzet</TableHead>
                    <TableHead className="text-right">Rata-rata diskon</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.byCashier.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                        Belum ada transaksi.
                      </TableCell>
                    </TableRow>
                  ) : (
                    report.byCashier.map((row) => (
                      <TableRow key={row.cashierId ?? "tanpa-kasir"}>
                        <TableCell className="font-medium">
                          {row.cashierName ?? "-"}
                        </TableCell>
                        <TableCell className="text-right">{row.count}</TableCell>
                        <TableCell className="text-right">
                          {formatRupiah(row.revenue)}
                        </TableCell>
                        <TableCell className="text-right">{row.avgDiscountPct}%</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Rekap pembayaran</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Metode</TableHead>
                    <TableHead className="text-right">Transaksi</TableHead>
                    <TableHead className="text-right">Jumlah</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.payments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                        Belum ada pembayaran.
                      </TableCell>
                    </TableRow>
                  ) : (
                    report.payments.map((payment) => (
                      <TableRow key={payment.method}>
                        <TableCell>{METHOD_LABEL[payment.method] ?? payment.method}</TableCell>
                        <TableCell className="text-right">{payment.count}</TableCell>
                        <TableCell className="text-right">{formatRupiah(payment.amount)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Status sinkronisasi</CardTitle>
              <CardDescription>
                Antrean yang belum terkirim hanya terlihat di perangkat kasir
                (lencana di header).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Penjualan asal offline (rentang ini)</span>
                <span className="font-medium">{report.offlineSalesCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Konflik terbuka</span>
                <span className="font-medium">
                  {report.openConflicts > 0 ? (
                    <Badge variant="destructive">{report.openConflicts}</Badge>
                  ) : (
                    "0"
                  )}
                </span>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to="/sinkronisasi">Tinjau sinkronisasi</Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Produk terlaris</CardTitle>
            <CardDescription>
              20 teratas menurut jumlah terjual. Nilai penjualan sebelum diskon
              seluruh keranjang.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Terjual</TableHead>
                  <TableHead className="text-right">Nilai</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.topProducts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      Belum ada penjualan.
                    </TableCell>
                  </TableRow>
                ) : (
                  report.topProducts.map((item) => (
                    <TableRow key={item.variantId}>
                      <TableCell>
                        <span className="font-medium">{item.productName}</span>
                        {item.label ? (
                          <span className="text-muted-foreground"> · {item.label}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{item.sku}</TableCell>
                      <TableCell className="text-right">{item.qty}</TableCell>
                      <TableCell className="text-right">{formatRupiah(item.gross)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Persediaan</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Varian aktif" value={String(summary.variants)} hint={`${summary.units} unit di stok.`} />
          <Stat label="Nilai stok (harga beli)" value={formatRupiah(summary.costValue)} hint="Stok negatif dihitung nol." />
          <Stat label="Nilai stok (harga jual)" value={formatRupiah(summary.sellValue)} />
          <Stat
            label="Perlu perhatian"
            value={`${summary.low} menipis`}
            hint={`${summary.empty} habis, ${summary.negative} stok negatif.`}
          />
        </div>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Stok menipis</CardTitle>
            <CardDescription>
              Stok sama dengan atau di bawah minimum
              {summary.low > 200 ? `. Menampilkan 200 dari ${summary.low}.` : "."}{" "}
              Stok negatif biasanya berasal dari konflik penjualan offline.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Stok</TableHead>
                  <TableHead className="text-right">Minimum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stock.lowItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      Tidak ada stok menipis.
                    </TableCell>
                  </TableRow>
                ) : (
                  stock.lowItems.map((item) => {
                    const label = variantLabel(item.size, item.color);
                    return (
                      <TableRow key={item.variantId}>
                        <TableCell>
                          <span className="font-medium">{item.productName}</span>
                          {label ? (
                            <span className="text-muted-foreground"> · {label}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{item.sku}</TableCell>
                        <TableCell
                          className={`text-right font-medium ${item.qty <= 0 ? "text-destructive" : ""}`}
                        >
                          {item.qty}
                        </TableCell>
                        <TableCell className="text-right">{item.minQty}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Button variant="outline" size="sm" asChild>
          <Link to="/stok?low=1">Kelola stok menipis</Link>
        </Button>
      </section>
    </div>
  );
}