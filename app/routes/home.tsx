import { HugeiconsIcon } from "@hugeicons/react";
import {
  Invoice01Icon,
  Layers01Icon,
  PackageIcon,
  ShoppingCart01Icon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { Link } from "react-router";
import type { Route } from "./+types/home";
import { requireUser } from "~/.server/auth/session";
import { withDb } from "~/.server/db/client";
import { listVariants } from "~/.server/services/catalog";
import {
  addDays,
  getSalesReport,
  jakartaToday,
  parseRange,
} from "~/.server/services/reports";
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
    return { stats: null, sales: null };
  }

  const storeId = user.storeId;
  // Rentang 7 hari terakhir (waktu Jakarta) untuk grafik penjualan.
  const today = jakartaToday();
  const { range } = parseRange(addDays(today, -6), today);

  const [rows, report] = await withDb(async (db) => {
    const [rows, report] = await Promise.all([
      listVariants(db, { businessId: user.businessId, storeId }),
      getSalesReport(db, { businessId: user.businessId, storeId, range }),
    ]);
    return [rows, report] as const;
  });

  const low = rows.filter((row) => row.qty <= row.minQty);
  const byDay = new Map(report.days.map((row) => [row.day, row]));

  // Isi 7 hari berturut-turut agar grafik punya sumbu tetap (hari kosong = 0).
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(range.from, i);
    const row = byDay.get(day);
    return { day, revenue: row?.revenue ?? 0, count: row?.count ?? 0 };
  });

  const todayRow = byDay.get(today);

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
    sales: {
      week,
      weekRevenue: report.totals.revenue,
      weekCount: report.totals.count,
      todayRevenue: todayRow?.revenue ?? 0,
      todayCount: todayRow?.count ?? 0,
    },
  };
}

const shortDay = new Intl.DateTimeFormat("id-ID", {
  weekday: "short",
  timeZone: "UTC",
});
const longDay = new Intl.DateTimeFormat("id-ID", {
  weekday: "long",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

type Tone = "primary" | "destructive" | "muted" | "success";

const TONE_CLASS: Record<Tone, string> = {
  primary: "bg-primary/10 text-primary",
  destructive: "bg-destructive/10 text-destructive",
  muted: "bg-muted text-muted-foreground",
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500",
};

function StatCard({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof Layers01Icon;
  label: string;
  value: string;
  hint?: string;
  tone: Tone;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 pt-6">
        <span
          className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${TONE_CLASS[tone]}`}
        >
          <HugeiconsIcon icon={icon} strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <CardDescription className="truncate">{label}</CardDescription>
          <CardTitle className="text-2xl">{value}</CardTitle>
          {hint ? (
            <p className="truncate text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { stats, sales } = loaderData;

  const cashierButton = (
    <Button asChild>
      <Link to="/kasir">
        <HugeiconsIcon icon={ShoppingCart01Icon} strokeWidth={2} />
        Buka kasir
      </Link>
    </Button>
  );

  if (!stats || !sales) {
    return (
      <>
        <PageHeader
          title="Beranda"
          description="Selamat datang."
          actions={cashierButton}
        />
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <HugeiconsIcon icon={ShoppingCart01Icon} strokeWidth={2} />
            </span>
            <div>
              <CardTitle>Kasir</CardTitle>
              <CardDescription>
                Mulai transaksi baru atau lihat riwayat penjualan Anda.
              </CardDescription>
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  const maxRevenue = Math.max(1, ...sales.week.map((w) => w.revenue));
  const safeCount = Math.max(stats.variants - stats.lowCount, 0);
  const healthPct =
    stats.variants > 0
      ? Math.round((safeCount / stats.variants) * 100)
      : 100;

  return (
    <>
      <PageHeader
        title="Beranda"
        description="Ringkasan penjualan dan persediaan toko."
        actions={cashierButton}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Layers01Icon}
          label="Varian aktif"
          value={`${stats.variants}${stats.capped ? "+" : ""}`}
          hint="Produk yang bisa dijual."
          tone="primary"
        />
        <StatCard
          icon={PackageIcon}
          label="Stok menipis"
          value={String(stats.lowCount)}
          hint={stats.lowCount > 0 ? "Butuh restok segera." : "Semua stok aman."}
          tone={stats.lowCount > 0 ? "destructive" : "success"}
        />
        <StatCard
          icon={Tag01Icon}
          label="Nilai persediaan"
          value={formatRupiah(stats.stockValue)}
          hint="Menurut harga beli."
          tone="muted"
        />
        <StatCard
          icon={Invoice01Icon}
          label="Omzet 7 hari"
          value={formatRupiah(sales.weekRevenue)}
          hint={`${sales.weekCount} transaksi.`}
          tone="primary"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <div className="space-y-1">
              <CardTitle>Penjualan 7 hari</CardTitle>
              <CardDescription>
                Hari ini {formatRupiah(sales.todayRevenue)} ·{" "}
                {sales.todayCount} transaksi
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/laporan">Laporan lengkap</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="flex h-48 items-end gap-2 sm:gap-3">
              {sales.week.map((w) => (
                <div
                  key={w.day}
                  className="flex h-full flex-1 flex-col items-center justify-end gap-2"
                >
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className="w-full rounded-t-md bg-primary/70 transition-all hover:bg-primary"
                      style={{
                        height: `${Math.round((w.revenue / maxRevenue) * 100)}%`,
                      }}
                      title={`${longDay.format(asDate(w.day))} · ${formatRupiah(
                        w.revenue,
                      )} · ${w.count} transaksi`}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {shortDay.format(asDate(w.day))}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Kesehatan stok</CardTitle>
            <CardDescription>
              {safeCount} dari {stats.variants} varian dalam kondisi aman.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Stok sehat</span>
              <Badge
                variant={
                  healthPct >= 80
                    ? "outline"
                    : healthPct >= 50
                      ? "secondary"
                      : "destructive"
                }
              >
                {healthPct}%
              </Badge>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${healthPct}%` }}
              />
            </div>
            <dl className="space-y-1 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Aman</dt>
                <dd className="font-medium">{safeCount} varian</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Menipis</dt>
                <dd
                  className={`font-medium ${
                    stats.lowCount > 0 ? "text-destructive" : ""
                  }`}
                >
                  {stats.lowCount} varian
                </dd>
              </div>
            </dl>
          </CardContent>
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
