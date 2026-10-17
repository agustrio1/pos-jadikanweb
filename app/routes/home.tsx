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
      today,
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
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

// Format Rupiah ringkas untuk label sumbu (mis. 1,5 jt / 12 rb).
function compactRupiah(n: number): string {
  if (n >= 1_000_000_000) {
    return `${(n / 1_000_000_000).toFixed(1).replace(".", ",")} M`;
  }
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(".", ",")} jt`;
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)} rb`;
  return String(Math.round(n));
}

// Nilai uang untuk kartu statistik: diringkas bila >= 1 juta agar rapi dan
// tidak terpotong di tepi kartu (mis. "Rp 6,2 jt" alih-alih "Rp 6.202.000").
function statMoney(n: number): string {
  return n >= 1_000_000 ? `Rp ${compactRupiah(n)}` : formatRupiah(n);
}

type WeekPoint = { day: string; revenue: number; count: number };

function SalesChart({
  week,
  today,
}: {
  week: WeekPoint[];
  today: string;
}) {
  const maxRevenue = Math.max(1, ...week.map((w) => w.revenue));
  // Empat garis acuan (0%, 25%, 50%, 75%, 100%) untuk sumbu Y.
  const ticks = [1, 0.75, 0.5, 0.25, 0];

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {/* Label sumbu Y */}
        <div className="flex h-52 w-10 shrink-0 flex-col justify-between text-right text-[10px] tabular-nums text-muted-foreground">
          {ticks.map((t) => (
            <span key={t} className="leading-none">
              {compactRupiah(Math.round(maxRevenue * t))}
            </span>
          ))}
        </div>

        {/* Area batang + garis acuan */}
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 flex h-52 flex-col justify-between">
            {ticks.map((t) => (
              <div key={t} className="border-t border-dashed border-border/70" />
            ))}
          </div>
          <div className="relative flex h-52 items-end gap-2 sm:gap-3">
            {week.map((w) => {
              const pct = Math.round((w.revenue / maxRevenue) * 100);
              const isToday = w.day === today;
              return (
                <div
                  key={w.day}
                  className="group relative flex h-full flex-1 items-end justify-center"
                >
                  {/* Tooltip saat kursor di atas batang */}
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-center text-xs shadow-md group-hover:block">
                    <p className="font-medium tabular-nums">
                      {formatRupiah(w.revenue)}
                    </p>
                    <p className="text-muted-foreground">
                      {w.count} transaksi
                    </p>
                  </div>
                  <div
                    className={`w-full max-w-12 rounded-t-lg transition-opacity duration-200 group-hover:opacity-90 ${
                      isToday
                        ? "bg-emerald-500"
                        : "bg-primary/70"
                    }`}
                    style={{ height: `${Math.max(pct, w.revenue > 0 ? 3 : 0)}%` }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Label hari */}
      <div className="flex gap-2 pl-12 sm:gap-3">
        {week.map((w) => (
          <div
            key={w.day}
            className={`flex-1 text-center text-xs ${
              w.day === today
                ? "font-semibold text-emerald-600 dark:text-emerald-500"
                : "text-muted-foreground"
            }`}
          >
            {shortDay.format(asDate(w.day))}
          </div>
        ))}
      </div>
    </div>
  );
}

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
          <CardTitle className="text-xl tracking-tight tabular-nums whitespace-nowrap">
            {value}
          </CardTitle>
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
          value={statMoney(stats.stockValue)}
          hint="Menurut harga beli."
          tone="muted"
        />
        <StatCard
          icon={Invoice01Icon}
          label="Omzet 7 hari"
          value={statMoney(sales.weekRevenue)}
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
            <SalesChart week={sales.week} today={sales.today} />
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
