import type { Route } from "./+types/laporan-csv";
import { requireAdminStore } from "~/.server/auth/guards";
import { withDb } from "~/.server/db/client";
import { getSalesReport, parseRange } from "~/.server/services/reports";

// Resource route (tanpa komponen): mengembalikan file CSV sebagai Response.
// Dibuat terpisah dari routes/laporan.tsx karena loader halaman yang
// mengembalikan Response tetap merender komponen saat SSR — komponen itu
// akan menerima loaderData undefined dan gagal saat destructuring.
export async function loader({ request }: Route.LoaderArgs) {
  const { user, storeId } = await requireAdminStore(request);
  const url = new URL(request.url);
  const { range } = parseRange(
    url.searchParams.get("from"),
    url.searchParams.get("to"),
  );

  const report = await withDb((db) =>
    getSalesReport(db, {
      businessId: user.businessId,
      storeId,
      range,
    }),
  );

  // Ekspor CSV: angka mentah (Rupiah integer) dengan pemisah ";" sesuai
  // konvensi Excel Indonesia. Kolom teks di-escape bila perlu.
  return new Response(buildSalesCsv(report, range), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="laporan-${range.from}s${range.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

type SalesReport = Awaited<ReturnType<typeof getSalesReport>>;
type CsvValue = string | number | null;

// Sel CSV: bungkus tanda kutip bila memuat pemisah/kutip/baris baru.
function csvCell(value: CsvValue): string {
  const text = value === null ? "" : String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(cells: CsvValue[]): string {
  return cells.map(csvCell).join(";");
}

function buildSalesCsv(
  report: SalesReport,
  range: { from: string; to: string },
): string {
  const lines: string[] = [];
  const push = (...cells: CsvValue[]) => lines.push(csvRow(cells));

  push("Laporan penjualan");
  push("Dari", range.from, "Sampai", range.to);
  lines.push("");

  push("Per hari");
  push("Tanggal", "Transaksi", "Omzet", "Diskon", "Laba kotor", "Batal");
  for (const day of report.days) {
    push(day.day, day.count, day.revenue, day.discount, day.profit, day.voidCount);
  }
  lines.push("");

  push(
    "Total",
    report.totals.count,
    report.totals.revenue,
    report.totals.discount,
    report.totals.profit,
    report.totals.voidCount,
  );
  lines.push("");

  push("Per kasir");
  push("Kasir", "Transaksi", "Omzet", "Rata-rata diskon %");
  for (const row of report.byCashier) {
    push(row.cashierName ?? "-", row.count, row.revenue, row.avgDiscountPct);
  }
  lines.push("");

  push("Padatan jam");
  push("Jam", "Transaksi", "Omzet");
  for (const row of report.byHour) {
    push(`${row.hour}:00`, row.count, row.revenue);
  }
  lines.push("");

  push("Produk terlaris");
  push("Produk", "SKU", "Terjual", "Nilai");
  for (const row of report.topProducts) {
    const label = row.label
      ? `${row.productName} (${row.label})`
      : row.productName;
    push(label, row.sku, row.qty, row.gross);
  }

  // BOM agar Excel membaca UTF-8 dengan benar.
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
